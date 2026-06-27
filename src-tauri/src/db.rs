pub fn grants_root() -> &'static str {
    "grants"
}

pub fn grant_sources_root() -> &'static str {
    "grant_sources"
}

pub fn grant_source_path(source_id: &str) -> String {
    format!("grant_sources/{source_id}")
}

pub fn grant_path(portal_id: &str) -> String {
    format!("grants/{portal_id}")
}

pub fn organization_path(uid: &str) -> String {
    format!("organizations/{uid}")
}

pub fn organization_members_root() -> &'static str {
    "organization_members"
}

pub fn organization_member_path(organization_uid: &str, firebase_uid: &str) -> String {
    format!("organization_members/{organization_uid}/{firebase_uid}")
}

pub fn memberships_root() -> &'static str {
    "memberships"
}

pub fn membership_path(firebase_uid: &str, organization_uid: &str) -> String {
    format!("memberships/{firebase_uid}/{organization_uid}")
}

pub fn workspace_invites_root() -> &'static str {
    "workspace_invites"
}

pub fn workspace_invite_path(invite_token: &str) -> String {
    format!("workspace_invites/{invite_token}")
}

pub fn watchlist_path(uid: &str) -> String {
    format!("watchlist/{uid}")
}

pub fn watchlist_entry_path(uid: &str, portal_id: &str) -> String {
    format!("watchlist/{uid}/{portal_id}")
}

pub fn drafts_path(uid: &str) -> String {
    format!("drafts/{uid}")
}

pub fn draft_path(uid: &str, draft_id: &str) -> String {
    format!("drafts/{uid}/{draft_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_expected_rtdb_paths() {
        assert_eq!(grant_path("123"), "grants/123");
        assert_eq!(organization_path("abc"), "organizations/abc");
        assert_eq!(organization_members_root(), "organization_members");
        assert_eq!(memberships_root(), "memberships");
        assert_eq!(workspace_invites_root(), "workspace_invites");
        assert_eq!(
            organization_member_path("org", "uid"),
            "organization_members/org/uid"
        );
        assert_eq!(membership_path("uid", "org"), "memberships/uid/org");
        assert_eq!(
            workspace_invite_path("invite-123"),
            "workspace_invites/invite-123"
        );
        assert_eq!(watchlist_path("uid"), "watchlist/uid");
        assert_eq!(watchlist_entry_path("uid", "456"), "watchlist/uid/456");
        assert_eq!(draft_path("uid", "draft"), "drafts/uid/draft");
    }

    #[test]
    fn grant_source_path_builds_correctly() {
        assert_eq!(
            grant_source_path("ca-grants-portal"),
            "grant_sources/ca-grants-portal"
        );
    }

    #[test]
    fn grants_root_is_grants() {
        assert_eq!(grants_root(), "grants");
    }

    #[test]
    fn grant_sources_root_is_grant_sources() {
        assert_eq!(grant_sources_root(), "grant_sources");
    }

    #[test]
    fn drafts_path_builds_correctly() {
        assert_eq!(drafts_path("uid-abc"), "drafts/uid-abc");
    }

    #[test]
    fn organization_path_builds_correctly() {
        assert_eq!(
            organization_path("org-uid-999"),
            "organizations/org-uid-999"
        );
    }

    // ── security: path traversal inputs are preserved literally ───────────
    // RTDB paths are REST URL segments, not filesystem paths.
    // Traversal strings should be embedded literally in the path string —
    // the RTDB SDK / server is responsible for rejecting invalid keys.

    #[test]
    fn grant_path_with_traversal_string_preserves_literal() {
        let traversal = "../../secret";
        let result = grant_path(traversal);
        assert_eq!(result, format!("grants/{traversal}"));
        assert!(!result.contains("secret\n"), "no newline injection");
    }

    #[test]
    fn watchlist_entry_path_with_unicode_uid_preserves_literal() {
        let uid = "用户-001";
        let result = watchlist_entry_path(uid, "grant-1");
        assert_eq!(result, format!("watchlist/{uid}/grant-1"));
    }

    #[test]
    fn paths_never_produce_double_slash() {
        assert!(!grant_path("abc").contains("//"));
        assert!(!organization_path("uid").contains("//"));
        assert!(!organization_members_root().contains("//"));
        assert!(!memberships_root().contains("//"));
        assert!(!workspace_invites_root().contains("//"));
        assert!(!organization_member_path("org", "uid").contains("//"));
        assert!(!membership_path("uid", "org").contains("//"));
        assert!(!workspace_invite_path("invite").contains("//"));
        assert!(!draft_path("uid", "did").contains("//"));
        assert!(!watchlist_entry_path("uid", "pid").contains("//"));
    }

    // ── performance ───────────────────────────────────────────────────────

    #[test]
    fn path_builders_are_fast() {
        let start = std::time::Instant::now();
        for i in 0..1_000_000 {
            let id = i.to_string();
            let _ = grant_path(&id);
            let _ = draft_path(&id, &id);
            let _ = watchlist_entry_path(&id, &id);
            let _ = workspace_invite_path(&id);
        }
        assert!(
            start.elapsed().as_millis() < 500,
            "1M path builds should complete under 500ms"
        );
    }
}
