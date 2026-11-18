fn main() {
    let manifest = tauri_build::AppManifest::new().commands(&["extract_stakeout_pdf"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))
        .expect("Tauri build configuration is invalid");
}
