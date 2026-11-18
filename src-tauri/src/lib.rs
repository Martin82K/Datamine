#[cfg(feature = "desktop-smoke")]
mod desktop_smoke;
mod worker;

pub fn run() {
    let builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![worker::extract_stakeout_pdf]);
    #[cfg(feature = "desktop-smoke")]
    let builder = builder.on_page_load(desktop_smoke::on_page_load);
    builder
        .setup(|app| {
            #[cfg(feature = "desktop-smoke")]
            desktop_smoke::create_window(app)?;
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;

                if let Some(window) = app.get_webview_window("main") {
                    window.open_devtools();
                }
            }
            #[cfg(not(debug_assertions))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Spuštění desktopové aplikace Datamine selhalo");
}
