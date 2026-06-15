"""
Orchestrate discovery runs for the 17 test-repo services and let the
auto-trigger generate perf scores. Runs sequentially to avoid LLM
rate-limits and disk pressure from concurrent clones.

For each service:
  1. Activate the project (architecture-model-service @ :8080)
  2. POST /discovery/runs to discovery-service @ :8091 with
     confirmLlmSolo=true so tier-C runs aren't blocked.
  3. Poll GET /discovery/runs/:runId?projectId=... every 10s until the
     run is COMPLETED or FAILED. Hard cap per run: 30 min.
  4. Append a result row.

Writes incremental progress to discovery-runs-progress.json so an
external watcher can see status mid-flight.
"""
import json
import time
import urllib.request
import urllib.error

ARCH_MODEL = 'http://localhost:8080'
DISCOVERY = 'http://localhost:8091'

ORIG_ACTIVE = "b6e61465-a50e-4a97-b900-0d40c9a4a513"

PROGRESS_FILE = r'C:\Workspaces\SSD\architecture-store-and-diagrams\discovery-runs-progress.json'

# Same order/ids as setup-test-repos.py + service ids from the successful create run.
TARGETS = [
    # PetClinic already completed via pilot run (a7dc5c6c); skip.
    ('nestjs-realworld',      '747061c2-6975-429d-bcc8-9a8139dc9f8c', 'svc-mo8nsfj7-57h4r'),
    ('Saleor',                '918df920-c886-402b-86e6-b71dee92dcf0', 'svc-mosqw9pa-5jlxc'),
    ('react-redux-realworld', '9c6f0fb5-7a72-4eef-b868-cc18ac036a96', 'svc-modrxy6b-4prqe'),
    ('angular-realworld',     '811f94be-b74a-4e83-a51e-699bf3f0e260', 'svc-moyv6pl2-hxrbg'),
    ('WordPress',             '71b0ee8f-d8ea-41a5-a582-700828819cc3', 'svc-moat53u0-gfnwb'),
    ('eShopOnWeb',            'a5a015bd-2fe8-43cb-9b22-ed4e39668a42', 'svc-mo7dpzyf-o4lac'),
    ('flask-microblog',       '2a51d920-90ea-465b-a0a7-feb6aac509d1', 'svc-mo2c3k9k-bdeas'),
    ('Redmine',               '6521e8ab-1ba1-4bf8-8119-baaef51dee07', 'svc-mowyibpn-fecnk'),
    ('Discourse',             '5a4dc7b3-364d-4981-a494-953bd5f299cf', 'svc-mohrmmqz-ly0yn'),
    ('beer-shop-go',          '0e828c3e-413b-4ccb-ad02-017dc260d018', 'svc-moas6iuv-hh084'),
    ('OrangeHRM',             'fd0fd396-22a0-4895-b8f8-e87cdca394df', 'svc-mo2fwkti-2tk93'),
    ('eShopLegacyMVC',        'c0dafafc-39b1-4ba2-a83a-54439dbf9f8a', 'svc-mofvde8z-j25k3'),
    ('magento-lts',           '05b60ec7-a462-4703-ba65-26605f41b6a6', 'svc-moircdjc-oy1nl'),
    ('jquery-ui',             '94b7a050-a8f9-4d69-b1e3-6f8c8d9a00dd', 'svc-moaequpm-igk0k'),
    ('wxWidgets',             'd9a57446-81ab-49bb-b62b-b7b4fbb482e7', 'svc-movs160z-hb5wg'),
    ('oatpp-crud',            '8e9d09e0-5b60-4355-9edd-4cab154e7eef', 'svc-mo0c8iab-58e5a'),
]

POLL_INTERVAL_S = 15
HARD_TIMEOUT_S = 25 * 60  # 25 min per run — bail if LLM hangs

ADOPT_RUNS = {}


def http(method, base, path, body=None, timeout=30):
    url = base + path
    data = None
    headers = {'Accept': 'application/json'}
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            txt = resp.read().decode('utf-8')
            return resp.getcode(), (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode('utf-8'))
        except Exception:
            return e.code, {}
    except Exception as e:
        return -1, {'error': str(e)}


def activate(project_id):
    code, _ = http('POST', ARCH_MODEL, f'/api/projects/{project_id}/activate')
    return code


def start_run(project_id, service_id):
    code, body = http('POST', DISCOVERY, '/discovery/runs', {
        'projectId': project_id,
        'serviceId': service_id,
        'confirmLlmSolo': True,
    })
    return code, body


def poll_run(project_id, run_id):
    """Poll a run until it terminates, with two safety nets:
    1. Hard timeout (HARD_TIMEOUT_S) since polling started.
    2. Stall detection: if `updated_at` hasn't advanced for 10 min, bail.
    """
    deadline = time.time() + HARD_TIMEOUT_S
    last_status = None
    last_updated_at = None
    last_updated_seen_at = time.time()
    last_step = None
    poll_count = 0
    STALL_S = 10 * 60
    while time.time() < deadline:
        poll_count += 1
        code, body = http('GET', DISCOVERY, f'/discovery/runs/{run_id}?projectId={project_id}', timeout=15)
        if code != 200 or not isinstance(body, dict):
            time.sleep(POLL_INTERVAL_S)
            continue
        status = body.get('status') or 'UNKNOWN'
        step = body.get('current_step')
        updated_at = body.get('updated_at')
        if status != last_status or step != last_step:
            print(f'    [poll {poll_count}] status={status} step={step}')
            last_status = status
            last_step = step
        if status in ('COMPLETED', 'FAILED', 'CANCELLED'):
            return status, body
        if updated_at != last_updated_at:
            last_updated_at = updated_at
            last_updated_seen_at = time.time()
        elif time.time() - last_updated_seen_at > STALL_S:
            print(f'    [poll] STALLED — no updated_at change for {STALL_S}s')
            return 'STALLED', body
        time.sleep(POLL_INTERVAL_S)
    return 'TIMEOUT', {}


def write_progress(results, current=None):
    payload = {
        'started_at': results[0].get('started_at') if results else None,
        'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'current': current,
        'completed': sum(1 for r in results if r.get('final_status') == 'COMPLETED'),
        'failed': sum(1 for r in results if r.get('final_status') in ('FAILED', 'TIMEOUT', 'CANCELLED')),
        'errors': sum(1 for r in results if isinstance(r.get('start_status_code'), int) and r['start_status_code'] >= 400),
        'total': len(TARGETS),
        'results': results,
    }
    with open(PROGRESS_FILE, 'w') as f:
        json.dump(payload, f, indent=2)


def main():
    results = []
    overall_start = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    print(f'Starting {len(TARGETS)} discovery runs at {overall_start}')

    for i, (name, project_id, service_id) in enumerate(TARGETS, start=1):
        print(f'\n[{i}/{len(TARGETS)}] {name} (svc={service_id})')
        run_started = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        result = {
            'name': name,
            'project_id': project_id,
            'service_id': service_id,
            'started_at': run_started,
            'final_status': 'PENDING',
        }
        results.append(result)
        write_progress(results, current=name)

        # 1. Activate
        ac = activate(project_id)
        if ac not in (200, 204):
            print(f'  FAIL activate -> HTTP {ac}')
            result['final_status'] = 'ACTIVATE_FAIL'
            result['activate_code'] = ac
            write_progress(results, current=None)
            continue

        # 2. Start run (or adopt a pre-existing in-flight one)
        adopted_run_id = ADOPT_RUNS.get(service_id)
        if adopted_run_id:
            print(f'  Adopting in-flight run={adopted_run_id}')
            run_id = adopted_run_id
            result['start_status_code'] = 'ADOPTED'
            result['adopted'] = True
        else:
            code, body = start_run(project_id, service_id)
            result['start_status_code'] = code
            if code not in (200, 201):
                err_code = (body or {}).get('code') if isinstance(body, dict) else None
                print(f'  FAIL start -> HTTP {code} ({err_code})')
                result['final_status'] = f'START_FAIL_{code}'
                result['start_body'] = body
                write_progress(results, current=None)
                continue
            run_id = body.get('id') or body.get('runId')
            result['mode'] = body.get('mode')
            result['tier'] = body.get('tier')
        result['run_id'] = run_id
        print(f'  run={run_id} tier={result.get("tier")} mode={result.get("mode")}')
        write_progress(results, current=name)

        # 3. Poll
        t_start = time.time()
        status, final_body = poll_run(project_id, run_id)
        elapsed_s = int(time.time() - t_start)
        result['final_status'] = status
        result['elapsed_s'] = elapsed_s
        if isinstance(final_body, dict):
            result['totals'] = final_body.get('totals')
            result['error'] = final_body.get('error')
        print(f'  Final status={status} after {elapsed_s}s')
        write_progress(results, current=None)

    # Restore active project
    activate(ORIG_ACTIVE)

    succ = sum(1 for r in results if r['final_status'] == 'COMPLETED')
    print(f'\n{succ}/{len(TARGETS)} runs COMPLETED')
    return 0 if succ == len(TARGETS) else 1


if __name__ == '__main__':
    raise SystemExit(main())
