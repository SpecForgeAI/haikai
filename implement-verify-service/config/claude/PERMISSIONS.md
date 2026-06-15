# Claude CLI Permissions Configuration

This document explains the permission rules configured in `settings.json` for the Haikai orchestration service.

## Permission Strategy

### Global Read Access
- **Read**: Unrestricted read access to the entire filesystem
- **Search**: Unrestricted search access across all directories

**Rationale**: Claude needs to read product context, existing code, documentation, and system files to understand the project structure and make informed decisions.

### Restricted Write Operations
All write, edit, and delete operations are confined to `/app/api_workspace/` directory only.

## Allowed Operations

### Read & Search (Global)
```json
"Read"     // Can read ANY file on the filesystem
"Search"   // Can search ANY directory
```

### Edit & Write (Restricted to api_workspace)
```json
"Edit(/app/api_workspace/**)"    // Can edit files ONLY in api_workspace
"Write(/app/api_workspace/**)"   // Can write files ONLY in api_workspace
```

### Bash Commands
```json
"Bash(cd /app/api_workspace*)"        // Navigate to api_workspace
"Bash(mkdir /app/api_workspace*)"     // Create directories in api_workspace
"Bash(rm /app/api_workspace*)"        // Delete files in api_workspace
"Bash(rm -rf /app/api_workspace*)"    // Recursively delete in api_workspace
"Bash(git *)"                         // All git commands allowed
```

## Denied Operations (Safety Rules)

### Path Traversal Protection
```json
"Edit(/app/api_workspace/../*)"    // Block parent directory edits via path traversal
"Write(/app/api_workspace/../*)"   // Block parent directory writes via path traversal
```

### Deletion Protection
```json
"Bash(rm /app/*)"        // Block deletion at /app root level
"Bash(rm -rf /app/*)"    // Block recursive deletion at /app root
"Bash(rm /*)"            // Block system-wide deletion
"Bash(rm -rf /*)"        // Block system-wide recursive deletion
```

### Sensitive File Protection
```json
"Read(/root/.ssh/*)"     // Block SSH keys
"Read(/root/.aws/*)"     // Block AWS credentials
"Read(/app/.env*)"       // Block environment variables
"Read(/app/secrets/*)"   // Block secrets directory
```

## Directory Structure

```
/app/
├── api_workspace/           ← Claude CAN edit/write/delete here
│   ├── haikai/
│   │   ├── specs/
│   │   └── product/
│   └── generated-code/
├── haikai-profiles/       ← Claude can READ but NOT edit
├── src/                     ← Claude can READ but NOT edit
├── .env                     ← Claude CANNOT read (blocked)
└── secrets/                 ← Claude CANNOT read (blocked)
```

## Security Considerations

1. **Read-only for application code**: Claude can read the application source code but cannot modify it
2. **Isolated workspace**: All Haikai generated files stay in `/app/api_workspace/`
3. **No credential access**: SSH keys, AWS credentials, and environment variables are protected
4. **Path traversal prevention**: Explicit deny rules prevent `../` attacks
5. **Deletion safety**: Cannot delete files outside api_workspace

## Testing the Configuration

To verify permissions are working correctly:

```bash
# Should work (allowed)
docker-compose exec standards-extractor-api claude -p "Create a file in /app/api_workspace/test.txt"
docker-compose exec standards-extractor-api claude -p "Read the file /app/src/main.py"

# Should fail (denied)
docker-compose exec standards-extractor-api claude -p "Edit the file /app/src/main.py"
docker-compose exec standards-extractor-api claude -p "Read /app/.env"
docker-compose exec standards-extractor-api claude -p "Delete /app/src/"
```

## Updating Permissions

To modify these permissions:

1. Edit `config/claude/settings.json`
2. Rebuild the Docker image: `docker-compose build standards-extractor-api`
3. Restart the container: `docker-compose up -d standards-extractor-api`
4. Test the new permissions

## References

- [Claude Code Settings Documentation](https://code.claude.com/docs/en/settings)
- [Claude Code Security Best Practices](https://code.claude.com/docs/en/security)
- [Permission Patterns Guide](https://www.eesel.ai/en/blog/claude-code-permissions)
