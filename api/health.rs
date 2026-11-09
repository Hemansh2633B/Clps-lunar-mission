use serde_json::{Value, json};
use vercel_runtime::{Error, Request, run, service_fn};

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}

async fn handler(_req: Request) -> Result<Value, Error> {
    Ok(json!({"status": "ok", "product": "CHANDRA Terrain Lab API"}))
}
