"""
Fix `core_tech_resolved` and `core_tech` for the test-repo services.

The original setup-test-repos.py wrote pack IDs (e.g. 'java-lang',
'java-spring-boot') into the `language.name` and `frameworks[].name`
JSON fields. The discovery service's `techHintsFromResolvedColumns`
function (runManager.ts:54) uses these names verbatim to build
techHints, and pack predicates expect human-readable names
('Java', 'Spring Boot'). The pack-id values never match, so no
adapter pack engages and the run falls back to LLM-only — Adapter %
collapses to 0 and the score plummets.

Run with `--only NAME` to patch a single service (pilot mode).
Otherwise patches all 17 in `MAPPING`.
"""
import argparse
import json
import sys
import urllib.request
import urllib.error

ARCH_MODEL = 'http://localhost:8080'

# (project_id, service_id, lang_name, lang_ver, fw_name, fw_ver, core_tech_text)
MAPPING = {
    'PetClinic':             ('fc3abaf2-19a5-466f-b3df-a6430183429e', 'svc-mob4f5ai-h4yfj', 'Java',       '17',     'Spring Boot',   '3.x',    'Java, Spring Boot'),
    'nestjs-realworld':      ('747061c2-6975-429d-bcc8-9a8139dc9f8c', 'svc-mo8nsfj7-57h4r', 'TypeScript', '',       'NestJS',        '',       'TypeScript, NestJS'),
    'Saleor':                ('918df920-c886-402b-86e6-b71dee92dcf0', 'svc-mosqw9pa-5jlxc', 'Python',     '3.x',    'Django',        '4.x',    'Python, Django'),
    'react-redux-realworld': ('9c6f0fb5-7a72-4eef-b868-cc18ac036a96', 'svc-modrxy6b-4prqe', 'JavaScript', '',       'React',         '',       'JavaScript, React'),
    'angular-realworld':     ('811f94be-b74a-4e83-a51e-699bf3f0e260', 'svc-moyv6pl2-hxrbg', 'TypeScript', '',       'Angular',       '',       'TypeScript, Angular'),
    'WordPress':             ('71b0ee8f-d8ea-41a5-a582-700828819cc3', 'svc-moat53u0-gfnwb', 'PHP',        '7.x/8.x','WordPress',     '',       'PHP, WordPress'),
    'eShopOnWeb':            ('a5a015bd-2fe8-43cb-9b22-ed4e39668a42', 'svc-mo7dpzyf-o4lac', 'C#',         '',       'ASP.NET Core',  '',       'C#, ASP.NET Core'),
    'flask-microblog':       ('2a51d920-90ea-465b-a0a7-feb6aac509d1', 'svc-mo2c3k9k-bdeas', 'Python',     '3.x',    'Flask',         '',       'Python, Flask'),
    'Redmine':               ('6521e8ab-1ba1-4bf8-8119-baaef51dee07', 'svc-mowyibpn-fecnk', 'Ruby',       '',       'Rails',         '',       'Ruby, Rails'),
    'Discourse':             ('5a4dc7b3-364d-4981-a494-953bd5f299cf', 'svc-mohrmmqz-ly0yn', 'Ruby',       '',       'Rails',         '',       'Ruby, Rails'),
    'beer-shop-go':          ('0e828c3e-413b-4ccb-ad02-017dc260d018', 'svc-moas6iuv-hh084', 'Go',         '',       'Kratos',        '',       'Go, Kratos'),
    'OrangeHRM':             ('fd0fd396-22a0-4895-b8f8-e87cdca394df', 'svc-mo2fwkti-2tk93', 'PHP',        '7.x/8.x','Symfony',       '',       'PHP, Symfony'),
    'eShopLegacyMVC':        ('c0dafafc-39b1-4ba2-a83a-54439dbf9f8a', 'svc-mofvde8z-j25k3', 'C#',         '',       'ASP.NET',       '',       'C#, ASP.NET (MVC, .NET Framework)'),
    'magento-lts':           ('05b60ec7-a462-4703-ba65-26605f41b6a6', 'svc-moircdjc-oy1nl', 'PHP',        '7.x',    'Magento',       '1.x',    'PHP, Magento'),
    'jquery-ui':             ('94b7a050-a8f9-4d69-b1e3-6f8c8d9a00dd', 'svc-moaequpm-igk0k', 'JavaScript', '',       'jQuery',        '',       'JavaScript, jQuery'),
    'wxWidgets':             ('d9a57446-81ab-49bb-b62b-b7b4fbb482e7', 'svc-movs160z-hb5wg', 'C++',        '',       'wxWidgets',     '',       'C++, wxWidgets'),
    'oatpp-crud':            ('8e9d09e0-5b60-4355-9edd-4cab154e7eef', 'svc-mo0c8iab-58e5a', 'C++',        '',       'Oatpp',         '',       'C++, Oatpp'),
}


def http(method, path, body=None, timeout=30):
    url = ARCH_MODEL + path
    data = json.dumps(body).encode('utf-8') if body is not None else None
    headers = {'Accept': 'application/json'}
    if data:
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


def patch_service(name, project_id, service_id, lang_name, lang_ver, fw_name, fw_ver, core_tech_text):
    print(f'\n[{name}] svc={service_id}')
    code, _ = http('POST', f'/api/projects/{project_id}/activate')
    if code not in (200, 204):
        print(f'  FAIL activate -> HTTP {code}')
        return False

    code, model = http('GET', f'/api/model?projectId={project_id}')
    if code != 200:
        print(f'  FAIL get model -> HTTP {code}')
        return False

    services = model.get('metaModel', {}).get('entities', {}).get('services', [])
    target = next((s for s in services if s.get('id') == service_id), None)
    if not target:
        print(f'  FAIL service not found in model')
        return False

    target['core_tech'] = core_tech_text
    target['core_tech_resolved'] = {
        'language': {'name': lang_name, 'version': lang_ver},
        'confidence': 'high',
        'frameworks': [{'name': fw_name, 'version': fw_ver}] if fw_name else [],
        'languagePack': target.get('core_tech_language_pack'),
        'frameworkPacks': list(target.get('core_tech_framework_packs') or []),
        'repoCrossCheck': {
            'note': 'Patched by fix-test-repo-tech-hints.py to use human-readable names so pack predicates match.',
            'status': 'patched',
        },
        'confirmationSentence': f'Test-repo setup: {core_tech_text}.',
    }

    filename = f'test-repo-{name.lower().replace(" ", "-")}.json'
    code, body = http('PUT', f'/api/model?filename={filename}', model)
    if code in (200, 201):
        print(f'  OK patched: language="{lang_name}", framework="{fw_name}"')
        return True
    print(f'  FAIL put -> HTTP {code}: {str(body)[:200]}')
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', help='Patch only one service by name (pilot mode)')
    args = ap.parse_args()

    targets = MAPPING
    if args.only:
        if args.only not in MAPPING:
            print(f'Unknown name: {args.only}. Valid: {", ".join(MAPPING)}')
            return 2
        targets = {args.only: MAPPING[args.only]}

    ok = 0
    for n, t in targets.items():
        if patch_service(n, *t):
            ok += 1
    print(f'\n{ok}/{len(targets)} patched.')
    return 0 if ok == len(targets) else 1


if __name__ == '__main__':
    sys.exit(main())
