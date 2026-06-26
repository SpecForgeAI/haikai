"""GitLab management connector — discover & control GitLab features.

A general control plane over `python-gitlab` (already a dependency), grouped by
feature area. The first area is Runners; Pipelines/Jobs, Merge Requests, and
Environments/Deployments follow the same shape.

This is NOT `src/verification/connectors/gitlab_ci.py` — that module is the
narrow verdict connector (trigger/poll one pipeline by SHA to feed the D5
verification gate). This package browses and *acts on* the instance.
"""
