use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, time::Duration};

const MAX_REQUEST: usize = 2 * 1024 * 1024;
const MAX_RESPONSE: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpRequest {
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiHttpResponse {
    status: u16,
    body: String,
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
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(70))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(url)
        .headers(headers)
        .body(request.body)
        .send()
        .await
        .map_err(|e| format!("无法连接 AI 服务：{e}"))?;
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
        }));
        assert!(result.is_err());
    }
}
