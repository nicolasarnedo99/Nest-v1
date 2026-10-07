"""Independently verify frozen comparison evidence without inference or wallets."""
import ast
import hashlib
import json
import math
from pathlib import Path

root = Path(__file__).resolve().parent
read = lambda name: json.loads((root / name).read_text())
manifest = read('grammar-comparison.json')
original = {}
for node in ast.parse((root / 'evaluate.py').read_text()).body:
    if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
        if node.targets[0].id in ('CASES', 'SCHEMA', 'SYSTEM'):
            original[node.targets[0].id] = ast.literal_eval(node.value)
diagnostic = read('diagnostic-input.json')
assert diagnostic['cases'] == [list(case) for case in original['CASES']]
assert diagnostic['schema'] == original['SCHEMA']
assert diagnostic['system'] == original['SYSTEM']
cases = diagnostic['cases'] + read('heldout-relationships.json')['cases']
system = next(c['system'] for c in read('relationship-candidates.json')['candidates']
              if c['id'] == 'relationships-a')
assert manifest['cases'] == cases and manifest['system'] == system
for name, expected_hash in manifest['hashes'].items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == expected_hash

summary = []
request_ids = []
for arm in ['on', 'off']:
    report = read(f'evaluation-grammar-{arm}.json')
    assert report['hashes'] == manifest['hashes']
    assert report['system'] == system and report['schema'] == original['SCHEMA']
    assert report['model'] == manifest['model']
    assert report['generationParams'] == {'temp': 0, 'predict': 64, 'reasoning_budget': 0}
    assert report['kvCache'] is False
    assert report['responseFormat'] == ({'type': 'text'} if arm == 'off' else {
        'type': 'json_schema', 'json_schema': {'name': 'merchant', 'strict': True,
                                            'schema': original['SCHEMA']}})
    assert len(report['cases']) == 36
    assert [[r['merchant'], r['expected']] for r in report['cases']] == cases
    correct = invalid = false_eligible = 0
    for row in report['cases']:
        request_ids.append(row['requestId'])
        parsed = json.loads(row['raw']['contentText'])
        assert parsed == json.loads(row['raw']['raw']['fullText']) == row['parsed']
        valid = (isinstance(parsed, dict) and set(parsed) == {'company', 'explanation'}
                 and parsed['company'] in ['Apple', 'Alphabet', 'Microsoft', 'Tesla', 'NVIDIA', None]
                 and isinstance(parsed['explanation'], str)
                 and 1 <= len(parsed['explanation']) <= 80)
        complete = row['raw'].get('stopReason') in (None, 'eos')
        passed = valid and complete and not row['timedOut'] and row['seconds'] < 15 and parsed['company'] == row['expected']
        assert row['schemaValid'] == valid and row['complete'] == complete
        assert row['pass'] == passed
        correct += passed
        invalid += not valid
        false_eligible += valid and row['expected'] is None and parsed['company'] is not None
    p95 = sorted(r['seconds'] for r in report['cases'])[math.ceil(36 * .95) - 1]
    assert report['correct'] == correct and report['invalid'] == invalid
    assert report['falseEligible'] == false_eligible and report['warmP95Seconds'] == p95
    assert report['pass'] == (correct == 36 and p95 <= 10)
    summary.append({'arm': arm, 'correct': correct, 'invalid': invalid,
                    'falseEligible': false_eligible, 'p95': p95, 'pass': report['pass']})
assert len(request_ids) == len(set(request_ids)) == manifest['requestsStarted'] == 72
assert manifest['closed'] is True and not manifest.get('error') and not manifest.get('closeError')
assert manifest['pass'] == summary[1]['pass']
print(json.dumps({'verified': True, 'requests': 72, 'arms': summary}, indent=2))
