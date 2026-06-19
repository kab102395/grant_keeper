# docx-sidecar

Node-based document export worker for Grant Keeper.

`worker.mjs` receives an export payload JSON file and writes a `.docx` draft package to the user's Downloads folder. The Rust command serializes the draft/grant/org payload and launches this worker during export.
