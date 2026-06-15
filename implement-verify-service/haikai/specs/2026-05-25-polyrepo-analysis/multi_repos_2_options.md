Solution 1 — Reuse Service-level git_repo

  +-------------------------------------+    +---------------------------------------+
  | This codebase (frontend + AMS)      |    | External implementing service         |
  +-------------------------------------+    +---------------------------------------+
  |                                     |    |                                       |
  |  Project                            |    |  Sub-folders it generated             |
  |    id                               |    |    [ frontend/, api/, shared/lib/ ]   |
  |    git_repo  (project-level)        |    |                                       |
  |                                     |    |  Folder -> Service.id map  <-- NEW    |
  |  Service                            |    |    { frontend/   -> service-A,        |
  |    id, name                         |    |      api/        -> service-B,        |
  |    git_repo  (reused for commits)   |    |      shared/lib/ -> service-A }       |
  |                                     |    |                                       |
  +-------------------------------------+    +---------------------------------------+
         ^                                          |
         | (commit time fetch of Service.git_repo)  |
         +------------------------------------------+

  Modal load
  modal open --> implementing-svc GET /projects/:id/folder-service-map
                    +
              this codebase ALSO fetches services from AMS so the modal
              can show a Service-name dropdown per sub-folder row

  Modal save
  user picks Service for each sub-folder
     --> implementing-svc POST /projects/:id/folder-service-map
         body: { "frontend/": "service-A", "api/": "service-B", ... }

  Commit (implementing service side)
  diff lives in `frontend/`
     --> look up `frontend/` in folder->Service.id map  -> service-A
     --> GET AMS  /services/service-A                   -> git_repo
     --> git push to that repo
  (if folder not mapped: fall back to Project.git_repo from AMS)

  Side-effects of this option
  - "Change repo for the frontend folder" = mutate Service.git_repo, which also changes where Service-A's discovery scans point. Editing one thing breaks the other.
  - Indirect lookup chain at commit time: folder -> Service.id -> Service.git_repo (two hops, two systems).

  ---
  Solution 2 — Direct sub-folder → repo mapping in implementing service

  +-------------------------------------+    +---------------------------------------+
  | This codebase (frontend + AMS)      |    | External implementing service         |
  +-------------------------------------+    +---------------------------------------+
  |                                     |    |                                       |
  |  Project                            |    |  Sub-folders it generated             |
  |    id                               |    |    [ frontend/, api/, shared/lib/ ]   |
  |    git_repo  (fallback only)        |    |                                       |
  |                                     |    |  Folder -> repo URL map  <-- NEW      |
  |  Project Settings                   |    |    { frontend/   -> "git@...frontend",|
  |    "Repo Mappings..." button (new)  |    |      api/        -> "git@...api",     |
  |                                     |    |      shared/lib/ -> null }            |
  |                                     |    |                                       |
  |  Service                            |    |                                       |
  |    git_repo  (untouched -- discovery|    |                                       |
  |                only)                |    |                                       |
  +-------------------------------------+    +---------------------------------------+
         ^                                          |
         | (commit time fetch of Project.git_repo   |
         |  ONLY when folder is unmapped)           |
         +------------------------------------------+

  Modal load
  modal open --> implementing-svc GET /projects/:id/repo-mappings
     response: [
       { sub_folder: "frontend/",   git_repo: "git@..."  },
       { sub_folder: "api/",        git_repo: "git@..."  },
       { sub_folder: "shared/lib/", git_repo: null       }
     ]
     --> render: sub_folder column (read-only) | git_repo (free text)

  Modal save
  user edits any git_repo cells
     --> implementing-svc POST /projects/:id/repo-mappings
         body: [
           { sub_folder: "frontend/",   git_repo: "git@..." },
           { sub_folder: "api/",        git_repo: "git@..." },
           { sub_folder: "shared/lib/", git_repo: null      }
         ]

  Commit (implementing service side)
  diff lives in `frontend/`
     --> look up `frontend/` in folder->repo map  -> "git@.../frontend"
     --> git push to that repo
  (if folder unmapped OR git_repo is null:
     fall back to Project.git_repo -- single AMS read)

  Properties of this option
  - One mapping table, one source of truth per concern: implementing service owns commit routing, AMS continues to own discovery repos. No cross-coupling.
  - Direct lookup at commit time: folder -> repo URL (one hop, one system).
  - Sub-folder list stays implementation-defined (this codebase never models it).

  ---
  Side-by-side at the contract boundary

                                SOLUTION 1                 SOLUTION 2
  new endpoints on impl svc     GET folder-service-map     GET repo-mappings
                                POST folder-service-map    POST repo-mappings

  storage on impl svc           folder -> Service.id       folder -> repo URL
                                (indirection layer)        (direct)

  storage on this codebase      unchanged                  unchanged

  frontend reads from AMS       services list (for         project-level
  during modal-open             dropdowns)                 git_repo only
                                                           (already loaded
                                                           with project)

  commit-time lookups on        folder -> Service.id       folder -> repo URL
  impl svc                      then AMS  /services/:id    fallback AMS
                                (2 systems, 2 reads)       /projects/:id only
                                                           when unmapped

  re-mapping side-effects       editing routes also        none -- routes
                                changes discovery repo     and discovery
                                for that Service           are independent

  Hand that to the implementing-service developer and the trade-off is concrete: S1 is "fewer new endpoints + indirection + coupling with discovery" vs S2 is "two clean endpoints + direct lookup + zero side
  effects on existing fields". I'd still recommend S2, but the picture is now neutral enough to discuss.