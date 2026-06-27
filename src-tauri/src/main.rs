#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod commands;
mod config;
mod db;
mod draft_schema;
mod firebase;
mod ingest;
mod models;
mod rtdb;
mod source_adapters;
mod state;

use state::AppState;

fn main() {
    load_env();
    tracing_subscriber::fmt::init();

    let app_state = tauri::async_runtime::block_on(AppState::load())
        .expect("failed to initialize Grant Keeper app state");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::get_app_snapshot,
            commands::get_local_config,
            commands::update_local_config,
            commands::sign_in_with_email_password,
            commands::sign_up_with_email_password,
            commands::start_dev_profile,
            commands::create_workspace_account,
            commands::sign_in_to_workspace,
            commands::sign_up_to_join_workspace,
            commands::refresh_session,
            commands::validate_anthropic_api_key,
            commands::clear_session,
            commands::validate_setup,
            commands::list_grants,
            commands::get_grant,
            commands::upsert_grant,
            commands::delete_grant,
            commands::sync_public_grants,
            commands::list_organization,
            commands::upsert_organization,
            commands::delete_organization,
            commands::list_watchlist,
            commands::upsert_watchlist_entry,
            commands::delete_watchlist_entry,
            commands::list_grant_sources,
            commands::list_grant_source_health,
            commands::upsert_grant_source,
            commands::delete_grant_source,
            commands::sync_grant_source,
            commands::sync_enabled_grant_sources,
            commands::list_drafts,
            commands::get_draft,
            commands::upsert_draft,
            commands::delete_draft,
            commands::export_draft,
            commands::reveal_path_in_folder,
            commands::generate_draft,
            commands::ping
        ])
        .setup(|_app| {
            tracing::info!("Grant Keeper starting");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run Grant Keeper");
}

fn load_env() {
    let candidates = [".env", "../.env"];
    for candidate in candidates {
        let _ = dotenvy::from_path(candidate);
    }
}
