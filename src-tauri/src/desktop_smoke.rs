// Compiled only for the native CI smoke executable, never for installers.
use tauri::{
    Manager, Runtime, Webview,
    webview::{PageLoadEvent, PageLoadPayload},
};

pub fn create_window<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let builder = tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?;
    // WKWebView needs a persistent store for IndexedDB Blob writes. Use a
    // dedicated test profile separate from the normal app's data.
    #[cfg(target_os = "macos")]
    let builder = builder.data_store_identifier(*b"datamine-ci-test");
    builder.build()?;
    Ok(())
}

pub fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    if payload.event() != PageLoadEvent::Finished {
        return;
    }
    if let Some((_, result)) = payload
        .url()
        .query_pairs()
        .find(|(key, _)| key == "stakeoutSmokeResult")
    {
        if result == "ok" {
            println!("PDF -> V2 preview -> confirm -> retry -> CSV: 3 exact synthetic points");
        } else {
            eprintln!("PDF to CSV smoke failed: {result}");
        }
        webview.app_handle().exit(i32::from(result != "ok"));
        return;
    }
    let script = format!(
        "({})({{pdf: {:?}, expectedCsv: {:?}}})",
        include_str!("../../tests/desktop-stakeout.js"),
        include_bytes!("../../fixtures/stakeout/synthetic.pdf"),
        include_bytes!("../../fixtures/stakeout/expected.csv")
    );
    if let Err(error) = webview.eval(script) {
        eprintln!("Cannot start native smoke: {error}");
        webview.app_handle().exit(1);
    }
}
