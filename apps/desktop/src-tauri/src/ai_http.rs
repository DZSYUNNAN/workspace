use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, process::Command, time::Duration};

const MAX_REQUEST: usize = 2 * 1024 * 1024;
const MAX_RESPONSE: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: String,
    network_mode: Option<String>,
    proxy_url: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpResponse {
    status: u16,
    body: String,
}

#[derive(Clone, Debug, PartialEq)]
enum NetworkPath {
    Direct,
    Environment,
    Proxy(String),
}

fn normalize_proxy(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    let candidate = if raw.contains(';') {
        raw.split(';')
            .filter_map(|part| part.split_once('='))
            .find(|(key, _)| key.trim().eq_ignore_ascii_case("https"))
            .or_else(|| {
                raw.split(';')
                    .filter_map(|part| part.split_once('='))
                    .find(|(key, _)| key.trim().eq_ignore_ascii_case("http"))
            })
            .map(|(_, value)| value.trim())
            .unwrap_or(raw)
    } else if let Some((key, value)) = raw.split_once('=') {
        if key.eq_ignore_ascii_case("http") || key.eq_ignore_ascii_case("https") {
            value.trim()
        } else {
            raw
        }
    } else {
        raw
    };
    let url = if candidate.contains("://") {
        candidate.to_string()
    } else {
        format!("http://{candidate}")
    };
    reqwest::Url::parse(&url)
        .ok()
        .filter(|value| matches!(value.scheme(), "http" | "https"))
        .map(|_| url)
}

#[cfg(windows)]
fn windows_proxy() -> Option<String> {
    use std::os::windows::process::CommandExt;
    let query = |value: &str| {
        let mut command = Command::new("reg");
        command
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v",
                value,
            ])
            .creation_flags(0x08000000);
        command
            .output()
            .ok()
            .filter(|out| out.status.success())
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
    };
    let enabled = query("ProxyEnable")?;
    if !enabled.to_ascii_lowercase().contains("0x1") {
        return None;
    }
    let server = query("ProxyServer")?;
    let raw = server
        .lines()
        .find(|line| line.contains("ProxyServer"))?
        .split_whitespace()
        .last()?;
    normalize_proxy(raw)
}
#[cfg(not(windows))]
fn windows_proxy() -> Option<String> {
    None
}

fn network_paths(
    mode: &str,
    configured: Option<String>,
    system: Option<String>,
) -> Result<Vec<NetworkPath>, String> {
    let configured = configured.as_deref().and_then(normalize_proxy);
    let paths = match mode {
        "direct" => vec![NetworkPath::Direct],
        "env" => vec![NetworkPath::Environment],
        "system" => system
            .and_then(|value| normalize_proxy(&value))
            .map(|value| vec![NetworkPath::Proxy(value)])
            .ok_or("Windows 系统代理未启用")?,
        "proxy" => configured
            .map(|value| vec![NetworkPath::Proxy(value)])
            .ok_or("请填写有效的 HTTP 代理地址")?,
        _ => {
            let mut values = vec![NetworkPath::Direct, NetworkPath::Environment];
            if let Some(value) = system.and_then(|value| normalize_proxy(&value)) {
                values.push(NetworkPath::Proxy(value));
            }
            if let Some(value) = configured {
                values.push(NetworkPath::Proxy(value));
            }
            values.dedup();
            values
        }
    };
    Ok(paths)
}

#[tauri::command]
pub async fn ai_http_request(request: AiHttpRequest) -> Result<AiHttpResponse, String> {
    let url = reqwest::Url::parse(&request.url).map_err(|_| "AI 接口地址无效".to_string())?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("AI 接口只支持 HTTP 或 HTTPS".into());
    }
    if request.method.to_uppercase() != "POST" {
        return Err("AI 接口只允许 POST 请求".into());
    }
    if request.body.len() > MAX_REQUEST {
        return Err("AI 请求内容超过 2 MB".into());
    }
    let mut headers = HeaderMap::new();
    for (name, value) in request.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|_| "AI 请求包含无效请求头".to_string())?;
        let value =
            HeaderValue::from_str(&value).map_err(|_| "AI 请求包含无效请求头值".to_string())?;
        headers.insert(name, value);
    }
    let paths = network_paths(
        request.network_mode.as_deref().unwrap_or("auto"),
        request.proxy_url,
        windows_proxy(),
    )?;
    let mut failures = Vec::new();
    let mut response = None;
    for path in paths {
        let label = match &path {
            NetworkPath::Direct => "direct",
            NetworkPath::Environment => "environment",
            NetworkPath::Proxy(_) => "proxy",
        };
        let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(25));
        builder = match path {
            NetworkPath::Direct => builder.no_proxy(),
            NetworkPath::Environment => builder,
            NetworkPath::Proxy(proxy) => builder
                .no_proxy()
                .proxy(reqwest::Proxy::all(&proxy).map_err(|_| "代理地址无效")?),
        };
        match builder
            .build()
            .map_err(|e| e.to_string())?
            .post(url.clone())
            .headers(headers.clone())
            .body(request.body.clone())
            .send()
            .await
        {
            Ok(value) => {
                response = Some(value);
                break;
            }
            Err(error) => failures.push(format!("{label}: {error}")),
        }
    }
    let response = response.ok_or_else(|| {
        format!(
            "无法连接 AI 服务（已尝试配置的网络路径）：{}",
            failures.join("；")
        )
    })?;
    let status = response.status().as_u16();
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE as u64)
    {
        return Err("AI 服务响应超过 8 MB".into());
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("读取 AI 响应失败：{e}"))?;
    if bytes.len() > MAX_RESPONSE {
        return Err("AI 服务响应超过 8 MB".into());
    }
    Ok(AiHttpResponse {
        status,
        body: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    #[test]
    fn posts_json_through_native_transport() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 2048];
            let read = stream.read(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request[..read]).starts_with("POST /chat HTTP/1.1"));
            let body = r#"{"choices":[{"message":{"content":"ok"}}]}"#;
            write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        });
        let response = tauri::async_runtime::block_on(ai_http_request(AiHttpRequest {
            url: format!("http://{address}/chat"),
            method: "POST".into(),
            headers: HashMap::from([("content-type".into(), "application/json".into())]),
            body: "{}".into(),
            network_mode: Some("direct".into()),
            proxy_url: None,
        }))
        .unwrap();
        server.join().unwrap();
        assert_eq!(response.status, 200);
        assert!(response.body.contains("choices"));
    }

    #[test]
    fn rejects_non_http_urls() {
        let result = tauri::async_runtime::block_on(ai_http_request(AiHttpRequest {
            url: "file:///secret".into(),
            method: "POST".into(),
            headers: HashMap::new(),
            body: "{}".into(),
            network_mode: None,
            proxy_url: None,
        }));
        assert!(result.is_err());
    }

    #[test]
    fn builds_direct_environment_system_and_karing_fallbacks() {
        assert_eq!(
            normalize_proxy("127.0.0.1:3067").as_deref(),
            Some("http://127.0.0.1:3067")
        );
        let paths = network_paths(
            "auto",
            Some("http://127.0.0.1:3067".into()),
            Some("https=127.0.0.1:7890".into()),
        )
        .unwrap();
        assert_eq!(
            paths,
            vec![
                NetworkPath::Direct,
                NetworkPath::Environment,
                NetworkPath::Proxy("http://127.0.0.1:7890".into()),
                NetworkPath::Proxy("http://127.0.0.1:3067".into())
            ]
        );
        assert!(network_paths("proxy", None, None)
            .unwrap_err()
            .contains("代理地址"));
    }
}
