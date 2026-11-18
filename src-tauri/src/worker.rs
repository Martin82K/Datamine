use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, ipc::InvokeBody, path::BaseDirectory};

const MAX_PDF_BYTES: usize = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES: u64 = 1024 * 1024;
const WORKER_TIMEOUT: Duration = Duration::from_secs(20);
const PROCESS_FAILURE: &str = "Lokální worker se nepodařilo spustit nebo dokončit.";
static WORKER_SLOT: Mutex<()> = Mutex::new(());

#[derive(Deserialize, Serialize)]
struct Point {
    code: String,
    name: String,
    point: [f64; 3],
    kind: String,
    page: u32,
    row: u32,
}

#[derive(Deserialize)]
struct WorkerOutput {
    points: Vec<Point>,
}

#[derive(Serialize)]
pub struct PdfProposal {
    source_document_sha256: String,
    points: Vec<Point>,
}

#[tauri::command]
pub async fn extract_stakeout_pdf(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<PdfProposal, &'static str> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Worker přijímá pouze binární PDF.");
    };
    if bytes.len() > MAX_PDF_BYTES || !bytes.starts_with(b"%PDF-") {
        return Err("Lokální worker přijímá PDF do 2 MiB.");
    }

    let filename = format!("worker/datamine-stakeout{}", std::env::consts::EXE_SUFFIX);
    let executable = app
        .path()
        .resolve(filename, BaseDirectory::Resource)
        .map_err(|_| PROCESS_FAILURE)?;
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || run_worker(&executable, &bytes))
        .await
        .map_err(|_| PROCESS_FAILURE)?
}

fn run_worker(executable: &Path, bytes: &[u8]) -> Result<PdfProposal, &'static str> {
    let _slot = WORKER_SLOT
        .try_lock()
        .map_err(|_| "Jiný výpočet PDF právě běží.")?;
    let mut command = Command::new(executable);
    command
        .current_dir(executable.parent().ok_or(PROCESS_FAILURE)?)
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW keeps an attached worker from opening a terminal.
        command.creation_flags(0x08000000);
        if let Some(root) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", root);
        }
    }

    let mut child = command.spawn().map_err(|_| PROCESS_FAILURE)?;
    let mut stdin = child.stdin.take().expect("worker has piped stdin");
    let stdout = child.stdout.take().expect("worker has piped stdout");
    let output = thread::scope(|scope| {
        let writer = scope.spawn(move || stdin.write_all(bytes));
        let reader = scope.spawn(move || {
            let mut output = Vec::new();
            stdout
                .take(MAX_OUTPUT_BYTES + 1)
                .read_to_end(&mut output)
                .map(|_| output)
        });
        let status = wait_bounded(&mut child);
        let written = writer.join().map_err(|_| PROCESS_FAILURE)?;
        let output = reader
            .join()
            .map_err(|_| PROCESS_FAILURE)?
            .map_err(|_| PROCESS_FAILURE)?;
        if !status? {
            return Err("PDF neobsahuje podporovanou tabulku BOD E N Z nebo je poškozené.");
        }
        written.map_err(|_| PROCESS_FAILURE)?;
        if output.len() as u64 > MAX_OUTPUT_BYTES {
            return Err("Výsledek zpracování PDF překročil limit.");
        }
        Ok(output)
    })?;
    let result: WorkerOutput = serde_json::from_slice(&output).map_err(|_| PROCESS_FAILURE)?;
    Ok(PdfProposal {
        source_document_sha256: format!("{:x}", Sha256::digest(bytes)),
        points: result.points,
    })
}

fn wait_bounded(child: &mut Child) -> Result<bool, &'static str> {
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status.success()),
            Ok(None) if started.elapsed() < WORKER_TIMEOUT => {
                thread::sleep(Duration::from_millis(25));
            }
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(if result.is_ok() {
                    "Zpracování PDF překročilo časový limit."
                } else {
                    PROCESS_FAILURE
                });
            }
        }
    }
}
