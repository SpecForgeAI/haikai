"""Offline real tests for Merge Requests: pure normalizer + merge/close guards."""

from types import SimpleNamespace

import pytest

from src.connectors.gitlab import merge_requests
from src.connectors.gitlab.client import ConfirmationRequired


def test_mr_to_dict_maps_core_fields():
    obj = SimpleNamespace(attributes={
        "iid": 3, "title": "Add feature", "state": "opened",
        "source_branch": "feat", "target_branch": "main",
        "merge_status": "can_be_merged", "web_url": "https://gitlab.com/p/-/merge_requests/3",
    })
    d = merge_requests._mr_to_dict(obj)
    assert d["iid"] == 3 and d["state"] == "opened" and d["target_branch"] == "main"


def test_merge_requires_confirm():
    with pytest.raises(ConfirmationRequired):
        merge_requests.merge_merge_request("group/proj", 3, confirm=False)


def test_close_requires_confirm():
    with pytest.raises(ConfirmationRequired):
        merge_requests.close_merge_request("group/proj", 3, confirm=False)
