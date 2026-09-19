import base64
import json
import os
import subprocess
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import boto3
import yaml
from moto import mock_aws


class CfnLoader(yaml.SafeLoader):
    pass


def intrinsic(loader, tag, node):
    if isinstance(node, yaml.ScalarNode):
        return {tag: loader.construct_scalar(node)}
    if isinstance(node, yaml.SequenceNode):
        return {tag: loader.construct_sequence(node)}
    return {tag: loader.construct_mapping(node)}


CfnLoader.add_multi_constructor('!', intrinsic)
ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = yaml.load((ROOT / 'infra/nuxt-account-cloudformation.yaml').read_text(), Loader=CfnLoader)
CODE = TEMPLATE['Resources']['ProfileFunction']['Properties']['Code']['ZipFile']


class ProfileTests(unittest.TestCase):
    def setUp(self):
        # Dummy credentials and Moto isolate this suite from a configured AWS account.
        environment = patch.dict(os.environ, {
            'AWS_ACCESS_KEY_ID': 'testing', 'AWS_SECRET_ACCESS_KEY': 'testing',
            'AWS_SESSION_TOKEN': 'testing', 'AWS_EC2_METADATA_DISABLED': 'true',
            'AWS_DEFAULT_REGION': 'ap-northeast-1', 'PROFILE_TABLE': 'unit-profile',
        })
        environment.start()
        self.addCleanup(environment.stop)
        self.mock = mock_aws()
        self.mock.start()
        self.addCleanup(self.mock.stop)
        self.table = boto3.resource('dynamodb').create_table(
            TableName='unit-profile', BillingMode='PAY_PER_REQUEST',
            AttributeDefinitions=[{'AttributeName': n, 'AttributeType': 'S'} for n in ['pk', 'sk']],
            KeySchema=[{'AttributeName': 'pk', 'KeyType': 'HASH'}, {'AttributeName': 'sk', 'KeyType': 'RANGE'}],
        )
        self.module = types.ModuleType('profile_lambda')
        exec(compile(CODE, '<inline-lambda>', 'exec'), self.module.__dict__)

    def event(self, method='GET', sub='user-a', body=None):
        return {
            'routeKey': method + ' /api/me',
            'requestContext': {'requestId': 'unit', 'authorizer': {'jwt': {'claims': {'sub': sub, 'token_use': 'access'}}}},
            'headers': {'content-type': 'application/json'},
            'body': json.dumps(body) if body is not None else '',
        }

    def call(self, event):
        result = self.module.handler(event, None)
        self.assertEqual(result['headers']['cache-control'], 'no-store')
        return result['statusCode'], json.loads(result['body'])

    def save(self, version=0, sub='user-a'):
        return self.call(self.event('PATCH', sub, {'displayName': 'Example User', 'locale': 'ja-JP', 'version': version}))

    def test_first_read_does_not_create_account(self):
        code, body = self.call(self.event())
        self.assertEqual((code, body['version']), (200, 0))
        self.assertEqual(self.table.scan()['Count'], 0)

    def test_create_update_and_stale_write(self):
        self.assertEqual(self.save(), (200, {'displayName': 'Example User', 'locale': 'ja-JP', 'version': 1}))
        self.assertEqual(self.save(1)[1]['version'], 2)
        self.assertEqual(self.save(1)[0], 409)
        self.assertEqual(self.save(0)[0], 409)

    def test_other_user_is_isolated(self):
        self.save()
        self.assertEqual(self.call(self.event(sub='user-b'))[1]['version'], 0)
        self.assertEqual(self.save(sub='user-b')[0], 200)
        self.assertEqual(self.table.scan()['Count'], 2)

    def test_user_id_override_is_rejected(self):
        event = self.event('PATCH', body={'displayName': 'X', 'locale': 'ja-JP', 'version': 0, 'userId': 'user-b'})
        self.assertEqual(self.call(event)[0], 400)
        self.assertEqual(self.table.scan()['Count'], 0)

    def test_missing_sub_or_id_token_is_rejected(self):
        self.assertEqual(self.call(self.event(sub=''))[0], 401)
        event = self.event()
        event['requestContext']['authorizer']['jwt']['claims']['token_use'] = 'id'
        self.assertEqual(self.call(event)[0], 401)

    def test_unavailable_account_cannot_read_or_reactivate(self):
        self.save()
        self.table.update_item(Key={'pk': 'USER#user-a', 'sk': 'PROFILE'},
                               UpdateExpression='SET #s = :s', ExpressionAttributeNames={'#s': 'status'},
                               ExpressionAttributeValues={':s': 'DELETING'})
        self.assertEqual(self.call(self.event())[0], 403)
        self.assertEqual(self.save(1)[0], 409)
        self.assertEqual(self.save(0)[0], 409)

    def test_json_content_type_and_size(self):
        event = self.event('PATCH')
        event['body'] = '{'
        self.assertEqual(self.call(event)[0], 400)
        event['headers']['content-type'] = 'text/plain'
        self.assertEqual(self.call(event)[0], 415)
        event['headers']['content-type'] = 'application/json'
        event['body'] = 'x' * 5000
        self.assertEqual(self.call(event)[0], 413)

    def test_base64_body(self):
        event = self.event('PATCH', body={'displayName': '検証ユーザー', 'locale': 'ja-JP', 'version': 0})
        event['body'] = base64.b64encode(event['body'].encode()).decode()
        event['isBase64Encoded'] = True
        self.assertEqual(self.call(event)[0], 200)
        event['body'] = '%%'
        self.assertEqual(self.call(event)[0], 400)

    def test_invalid_fields(self):
        cases = [('', 'ja-JP', 0), ('Hi\nX', 'ja-JP', 0), ('Hi', 'unknown', 0), ('Hi', 'ja-JP', True), ('Hi', 'ja-JP', -1)]
        for name, locale, version in cases:
            with self.subTest(case=(name, locale, version)):
                self.assertEqual(self.call(self.event('PATCH', body={'displayName': name, 'locale': locale, 'version': version}))[0], 400)

    def test_unimplemented_route(self):
        self.assertEqual(self.call(self.event('DELETE'))[0], 404)


class PathTests(unittest.TestCase):
    def test_nuxt_static_routes_and_api_exclusion(self):
        function = TEMPLATE['Resources']['NuxtPathFunction']['Properties']['FunctionCode']
        cases = {'/': '/index.html', '/account': '/account/index.html', '/login/callback': '/login/callback/index.html',
                 '/account/': '/account/index.html', '/_nuxt/file.js': '/_nuxt/file.js', '/api': '/api', '/api/me': '/api/me'}
        script = function + '\nconst cases = ' + json.dumps(cases) + ';\n'
        script += "for (const [input, expected] of Object.entries(cases)) { const r = handler({request: {uri: input, querystring: {code: {value: 'sample'}}}}); if (r.uri !== expected || r.querystring.code.value !== 'sample') throw new Error(input); }\n"
        subprocess.run(['node', '-e', script], check=True, capture_output=True, text=True)


if __name__ == '__main__':
    unittest.main(verbosity=2)
