use lettre::{
    message::{header::ContentType, Mailbox},
    transport::smtp::authentication::Credentials,
    Message, SmtpTransport, Transport,
};
use mailparse::MailHeaderMap;
use serde::{Deserialize, Serialize};
use std::{
    net::{TcpStream, ToSocketAddrs},
    time::Duration,
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    host: String,
    port: u16,
    security: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    address: String,
    username: String,
    imap: Endpoint,
    smtp: Endpoint,
}
impl Config {
    fn validate(&self, password: &str) -> Result<(), String> {
        self.address
            .parse::<Mailbox>()
            .map_err(|_| "邮箱地址格式不正确")?;
        if self.username.trim().is_empty()
            || self.username.contains(['\r', '\n'])
            || password.is_empty()
        {
            return Err("请填写登录用户名和密码／客户端授权码".into());
        }
        for endpoint in [&self.imap, &self.smtp] {
            if endpoint.host.is_empty()
                || endpoint.host.len() > 253
                || !endpoint
                    .host
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "-.:".contains(c))
                || endpoint.port == 0
            {
                return Err("服务器地址须为主机名，不能包含协议前缀或路径；端口为 1–65535".into());
            }
            if !["tls", "starttls"].contains(&endpoint.security.as_str()) {
                return Err("请选择 SSL/TLS 或 STARTTLS 加密".into());
            }
        }
        Ok(())
    }
}
fn error(stage: &str, error: impl std::fmt::Display, password: &str) -> String {
    let detail = error.to_string();
    let detail = if password.is_empty() {
        detail
    } else {
        detail.replace(password, "[已隐藏]")
    };
    format!("{stage}失败：{detail}。请核对服务器、端口和加密方式；认证失败时检查完整邮箱用户名、客户端授权码及 IMAP/SMTP 服务是否已开启。")
}
fn socket(endpoint: &Endpoint) -> Result<TcpStream, String> {
    let addresses = (endpoint.host.as_str(), endpoint.port)
        .to_socket_addrs()
        .map_err(|e| format!("服务器域名解析失败：{e}"))?;
    let mut last = String::from("服务器没有可用地址");
    for address in addresses.take(4) {
        match TcpStream::connect_timeout(&address, Duration::from_secs(10)) {
            Ok(stream) => {
                stream
                    .set_read_timeout(Some(Duration::from_secs(20)))
                    .map_err(|e| e.to_string())?;
                stream
                    .set_write_timeout(Some(Duration::from_secs(20)))
                    .map_err(|e| e.to_string())?;
                return Ok(stream);
            }
            Err(e) => last = e.to_string(),
        }
    }
    Err(format!(
        "无法连接 {}:{}：{last}",
        endpoint.host, endpoint.port
    ))
}
fn imap_client(
    endpoint: &Endpoint,
) -> Result<imap::Client<native_tls::TlsStream<TcpStream>>, String> {
    let stream = socket(endpoint)?;
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    if endpoint.security == "starttls" {
        let mut client = imap::Client::new(stream);
        client.read_greeting().map_err(|e| e.to_string())?;
        client
            .secure(&endpoint.host, &tls)
            .map_err(|e| e.to_string())
    } else {
        let stream = tls
            .connect(&endpoint.host, stream)
            .map_err(|e| format!("TLS 握手或证书校验失败：{e}"))?;
        let mut client = imap::Client::new(stream);
        client.read_greeting().map_err(|e| e.to_string())?;
        Ok(client)
    }
}
fn login(
    config: &Config,
    password: &str,
) -> Result<imap::Session<native_tls::TlsStream<TcpStream>>, String> {
    imap_client(&config.imap)
        .map_err(|e| error("IMAP 连接", e, password))?
        .login(&config.username, password)
        .map_err(|(e, _)| error("IMAP 认证", e, password))
}
fn smtp(config: &Config, password: &str) -> Result<SmtpTransport, String> {
    let builder = if config.smtp.security == "starttls" {
        SmtpTransport::starttls_relay(&config.smtp.host)
    } else {
        SmtpTransport::relay(&config.smtp.host)
    };
    Ok(builder
        .map_err(|e| error("SMTP 配置", e, password))?
        .port(config.smtp.port)
        .timeout(Some(Duration::from_secs(20)))
        .credentials(Credentials::new(config.username.clone(), password.into()))
        .build())
}
#[derive(Serialize)]
pub struct ConnectionReport {
    imap: String,
    smtp: String,
    folders: Vec<String>,
}
#[tauri::command]
pub async fn mail_test(config: Config, password: String) -> Result<ConnectionReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        config.validate(&password)?;
        let mut folders = Vec::new();
        let imap = match login(&config, &password) {
            Ok(mut session) => {
                let result = session.list(None, Some("*"));
                let status = match result {
                    Ok(names) => {
                        folders = names
                            .iter()
                            .filter(|n| {
                                !n.attributes()
                                    .contains(&imap::types::NameAttribute::NoSelect)
                            })
                            .map(|n| n.name().to_string())
                            .collect();
                        "IMAP 连接及登录成功".into()
                    }
                    Err(e) => error("IMAP 文件夹读取", e, &password),
                };
                let _ = session.logout();
                status
            }
            Err(e) => e,
        };
        let smtp = match smtp(&config, &password).and_then(|transport| {
            transport
                .test_connection()
                .map_err(|e| error("SMTP 连接或认证", e, &password))
        }) {
            Ok(true) => "SMTP 连接及认证成功（未发送邮件）".into(),
            Ok(false) => "SMTP 服务器没有确认连接".into(),
            Err(e) => e,
        };
        Ok(ConnectionReport {
            imap,
            smtp,
            folders,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Incoming {
    remote_key: String,
    subject: String,
    from_name: String,
    from_addr: String,
    to_list: Vec<String>,
    body_text: String,
    date: i64,
    is_read: bool,
    is_starred: bool,
    attachment_names: Vec<String>,
}
fn content(
    parsed: &mailparse::ParsedMail,
    plain: &mut Vec<String>,
    html: &mut Vec<String>,
    attachments: &mut Vec<String>,
) {
    let disposition = parsed.get_content_disposition();
    let filename = disposition
        .params
        .get("filename")
        .or_else(|| parsed.ctype.params.get("name"));
    if disposition.disposition == mailparse::DispositionType::Attachment || filename.is_some() {
        attachments.push(filename.cloned().unwrap_or_else(|| "未命名附件".into()));
        return;
    }
    if parsed.subparts.is_empty() {
        if parsed.ctype.mimetype == "text/plain" {
            if let Ok(body) = parsed.get_body() {
                plain.push(body);
            }
        } else if parsed.ctype.mimetype == "text/html" {
            if let Ok(body) = parsed.get_body() {
                html.push(body);
            }
        }
    } else {
        for child in &parsed.subparts {
            content(child, plain, html, attachments);
        }
    }
}
fn parse_message(raw: &[u8], key: String, read: bool, starred: bool) -> Result<Incoming, String> {
    let parsed = mailparse::parse_mail(raw).map_err(|e| e.to_string())?;
    let from = parsed.headers.get_first_value("From").unwrap_or_default();
    let mut plain = Vec::new();
    let mut html = Vec::new();
    let mut attachments = Vec::new();
    content(&parsed, &mut plain, &mut html, &mut attachments);
    // HTML is displayed as text by React, never injected into the page or loaded remotely.
    let body = if plain.is_empty() {
        html.join("\n")
    } else {
        plain.join("\n")
    };
    let from_addr = mailparse::addrparse(&from)
        .ok()
        .and_then(|a| a.extract_single_info())
        .map(|a| a.addr)
        .unwrap_or_else(|| from.clone());
    let date = parsed
        .headers
        .get_first_value("Date")
        .and_then(|s| mailparse::dateparse(&s).ok())
        .unwrap_or(0)
        .saturating_mul(1000);
    Ok(Incoming {
        remote_key: key,
        subject: parsed
            .headers
            .get_first_value("Subject")
            .unwrap_or_default(),
        from_name: from,
        from_addr,
        to_list: vec![parsed.headers.get_first_value("To").unwrap_or_default()],
        body_text: body,
        date,
        is_read: read,
        is_starred: starred,
        attachment_names: attachments,
    })
}
#[derive(Serialize)]
pub struct FetchResult {
    messages: Vec<Incoming>,
    skipped: usize,
}
fn receive<T: std::io::Read + std::io::Write>(
    session: &mut imap::Session<T>,
    folder: &str,
) -> Result<FetchResult, String> {
    let mailbox = session.examine(folder).map_err(|e| e.to_string())?;
    let mut result = FetchResult {
        messages: Vec::new(),
        skipped: 0,
    };
    if mailbox.exists == 0 {
        return Ok(result);
    }
    let validity = mailbox
        .uid_validity
        .ok_or("服务器没有提供 UIDVALIDITY，无法可靠去重")?;
    let range = format!(
        "{}:{}",
        mailbox.exists.saturating_sub(49).max(1),
        mailbox.exists
    );
    let metadata = session
        .fetch(range, "(UID RFC822.SIZE FLAGS)")
        .map_err(|e| e.to_string())?;
    let entries: Vec<_> = metadata
        .iter()
        .filter_map(|f| {
            f.uid.map(|uid| {
                (
                    uid,
                    f.size.unwrap_or(u32::MAX),
                    f.flags().contains(&imap::types::Flag::Seen),
                    f.flags().contains(&imap::types::Flag::Flagged),
                )
            })
        })
        .collect();
    let mut size: usize = 0;
    for (uid, length, read, starred) in entries {
        if length > 2 * 1024 * 1024 || size + length as usize > 20 * 1024 * 1024 {
            result.skipped += 1;
            continue;
        }
        let fetch = session
            .uid_fetch(uid.to_string(), "BODY.PEEK[]")
            .map_err(|e| e.to_string())?;
        if let Some(raw) = fetch.iter().next().and_then(|f| f.body()) {
            size += raw.len();
            result.messages.push(parse_message(
                raw,
                format!("{validity}:{uid}"),
                read,
                starred,
            )?);
        }
    }
    Ok(result)
}
#[tauri::command]
pub async fn mail_fetch(
    config: Config,
    password: String,
    folder: String,
) -> Result<FetchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        config.validate(&password)?;
        if folder.len() > 512 || folder.contains(['\r', '\n', '\0']) {
            return Err("文件夹名称无效".into());
        }
        let mut session = login(&config, &password)?;
        let result = receive(&mut session, &folder).map_err(|e| error("IMAP 收件", e, &password));
        let _ = session.logout();
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[derive(Deserialize)]
pub struct Outgoing {
    to: String,
    subject: String,
    body: String,
}
fn message(config: &Config, outgoing: Outgoing) -> Result<Message, String> {
    let mut builder = Message::builder()
        .from(config.address.parse().map_err(|_| "发件地址无效")?)
        .subject(outgoing.subject);
    let recipients: Vec<_> = outgoing
        .to
        .split([',', ';', '；'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if recipients.is_empty() {
        return Err("请填写收件人".into());
    }
    for recipient in recipients {
        builder = builder.to(recipient
            .parse()
            .map_err(|_| "收件地址无效，请用逗号分隔多个地址")?);
    }
    builder
        .header(ContentType::TEXT_PLAIN)
        .body(outgoing.body)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn mail_send(config: Config, password: String, outgoing: Outgoing) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        config.validate(&password)?;
        let message = message(&config, outgoing)?;
        smtp(&config, &password)?
            .send(&message)
            .map_err(|e| error("SMTP 发送", e, &password))?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> Config {
        Config {
            address: "test@example.edu".into(),
            username: "test@example.edu".into(),
            imap: Endpoint {
                host: "imap.exmail.qq.com".into(),
                port: 993,
                security: "tls".into(),
            },
            smtp: Endpoint {
                host: "smtp.exmail.qq.com".into(),
                port: 465,
                security: "tls".into(),
            },
        }
    }
    #[test]
    fn validates_endpoints_and_redacts_credentials() {
        let mut c = config();
        assert!(c.validate("secret").is_ok());
        c.imap.security = "none".into();
        assert!(c.validate("secret").is_err());
        c.imap.security = "tls".into();
        c.smtp.host = "https://smtp.example.edu/".into();
        assert!(c.validate("secret").is_err());
        assert!(!error("认证", "bad secret", "secret").contains("secret"));
    }
    #[test]
    fn parses_encoded_chinese_and_multipart_without_inlining_attachments() {
        let raw = b"Subject: =?UTF-8?B?5qCh5Zut6YKu566x?=\r\nFrom: Teacher <teacher@example.edu>\r\nContent-Type: multipart/mixed; boundary=part\r\n\r\n--part\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n5L2g5aW9\r\n--part\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=paper.pdf\r\n\r\ndata\r\n--part--\r\n";
        let parsed = parse_message(raw, "1:2".into(), false, true).unwrap();
        assert_eq!(parsed.subject, "校园邮箱");
        assert_eq!(parsed.body_text.trim(), "你好");
        assert_eq!(parsed.attachment_names, vec!["paper.pdf"]);
        assert_eq!(parsed.from_addr, "teacher@example.edu");
    }
    #[test]
    fn outgoing_validates_recipients_and_encodes_utf8() {
        assert!(message(
            &config(),
            Outgoing {
                to: "bad".into(),
                subject: "test".into(),
                body: "".into()
            }
        )
        .is_err());
        let msg = message(
            &config(),
            Outgoing {
                to: "one@example.edu;two@example.edu".into(),
                subject: "校园邮件".into(),
                body: "中文正文".into(),
            },
        )
        .unwrap();
        assert_eq!(msg.envelope().to().len(), 2);
        let parsed = parse_message(&msg.formatted(), "sent".into(), true, false).unwrap();
        assert_eq!(parsed.subject, "校园邮件");
        assert_eq!(parsed.body_text.trim(), "中文正文");
    }
    #[test]
    #[ignore = "connects to the user-provided public servers, without login or sending"]
    fn tencent_tls_handshakes() {
        let c = config();
        let _client = imap_client(&c.imap).unwrap();
        let stream = socket(&c.smtp).unwrap();
        let tls = native_tls::TlsConnector::new().unwrap();
        let mut stream = tls.connect(&c.smtp.host, stream).unwrap();
        let mut greeting = [0; 256];
        let n = std::io::Read::read(&mut stream, &mut greeting).unwrap();
        assert!(String::from_utf8_lossy(&greeting[..n]).starts_with("220"));
    }
    #[test]
    fn receives_uid_mail_readonly_and_skips_large_messages() {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut input = BufReader::new(stream.try_clone().unwrap());
            stream.write_all(b"* OK test IMAP\r\n").unwrap();
            loop {
                let mut line = String::new();
                if input.read_line(&mut line).unwrap() == 0 {
                    break;
                }
                let (tag, command) = line.trim_end().split_once(' ').unwrap();
                let response = if command.starts_with("LOGIN ") {
                    format!("{tag} OK login\r\n")
                } else if command.starts_with("EXAMINE ") {
                    format!("* 2 EXISTS\r\n* OK [UIDVALIDITY 7] ready\r\n{tag} OK [READ-ONLY] examine\r\n")
                } else if command == "FETCH 1:2 (UID RFC822.SIZE FLAGS)" {
                    format!("* 1 FETCH (UID 9 RFC822.SIZE 200 FLAGS (\\Seen))\r\n* 2 FETCH (UID 10 RFC822.SIZE 9000000 FLAGS ())\r\n{tag} OK fetch\r\n")
                } else if command == "UID FETCH 9 BODY.PEEK[]" {
                    let body = "From: teacher@example.edu\r\nSubject: Test\r\n\r\nHello";
                    format!(
                        "* 1 FETCH (UID 9 BODY[] {{{}}}\r\n{body})\r\n{tag} OK fetch\r\n",
                        body.len()
                    )
                } else if command == "LOGOUT" {
                    stream
                        .write_all(format!("* BYE done\r\n{tag} OK logout\r\n").as_bytes())
                        .unwrap();
                    break;
                } else {
                    panic!("unexpected protocol command: {command}");
                };
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        let stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut client = imap::Client::new(stream);
        client.read_greeting().unwrap();
        let mut session = client
            .login("test", "fixture-password")
            .map_err(|(e, _)| e)
            .unwrap();
        let result = receive(&mut session, "INBOX").unwrap();
        session.logout().unwrap();
        server.join().unwrap();
        assert_eq!(result.skipped, 1);
        assert_eq!(result.messages.len(), 1);
        assert_eq!(result.messages[0].remote_key, "7:9");
        assert_eq!(result.messages[0].body_text, "Hello");
        assert!(result.messages[0].is_read);
    }
}
