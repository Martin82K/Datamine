// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(
    all(not(debug_assertions), not(feature = "desktop-smoke")),
    windows_subsystem = "windows"
)]

fn main() {
    datamine_lib::run()
}
