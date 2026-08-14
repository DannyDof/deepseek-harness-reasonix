#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

const PORT: u16 = 8787;

/// 保持 sidecar 子进程句柄存活，应用退出时回收。
struct SidecarHandle(Mutex<Option<CommandChild>>);

/// 在资源目录下解析文件，兼容"直接平铺"与"resources/ 前缀"两种打包布局。
fn resolve_in(base: &Path, name: &str) -> PathBuf {
    let direct = base.join(name);
    if direct.exists() {
        direct
    } else {
        let nested = base.join("resources").join(name);
        if nested.exists() { nested } else { direct }
    }
}

fn wait_ready(port: u16) {
    for _ in 0..100 {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(200));
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarHandle(Mutex::new(None)))
        .setup(|app| {
            let resource_dir = app.path().resource_dir()?;
            let script = resolve_in(&resource_dir, "fused.cjs");
            let web_dir = resolve_in(&resource_dir, "web");

            let sidecar = app.shell().sidecar("reasonix-backend")?;
            let (_rx, child) = sidecar
                .arg(script.to_string_lossy().as_ref())
                .env("REASONIX_WEB_DIR", web_dir)
                .spawn()?;
            app.state::<SidecarHandle>().0.lock().unwrap().replace(child);

            wait_ready(PORT);

            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(format!("http://127.0.0.1:{PORT}").into()),
            )
            .title("Reasonix")
            .inner_size(1040.0, 760.0)
            .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Reasonix")
        .run(|app_handle, event| {
            if let RunEvent::Exit = event {
                if let Some(child) = app_handle.state::<SidecarHandle>().0.lock().unwrap().take() {
                    let _ = child.kill();
                }
            }
        });
}
