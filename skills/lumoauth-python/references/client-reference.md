# `lumoauth` Python client reference

Checked against the `lumoauth` package 1.4.0. Read this page before you call a method that `SKILL.md` does not show, or when a call fails with `401` or `403` and you need to know which credential or scope it needs.

## `LumoAuth(...)`

```python
from lumoauth import LumoAuth

client = LumoAuth(
    api_key=None,
    base_url=None,
    org_id=None,
    token_provider=None,
    timeout=30,
    skip_cert_validation=False,
)
```

All arguments are keyword-only.

| Argument | Type | Default | Meaning |
|---|---|---|---|
| `api_key` | `str` | `LUMOAUTH_API_KEY` | Organization API key (`lmk_...`). Sent as `X-API-Key` |
| `base_url` | `str` | `LUMOAUTH_URL`, then `https://app.lumoauth.dev` | The region: `https://app.lumoauth.dev` or `https://eu.app.lumoauth.dev` |
| `org_id` | `str` | `LUMOAUTH_ORG_ID` | Organization slug. Needed by organization-scoped calls |
| `token_provider` | `Callable[[], Optional[str]]` | none | Returns a bearer token. Called before each request. When it returns a token, the token is sent and the API key is not |
| `timeout` | `float` | `30` | Request timeout in seconds |
| `skip_cert_validation` | `bool` | `False` | Turns off TLS certificate checks. Local development only |

Attributes: `client.base_url`, `client.org_id`, `client.api_key`, `client.timeout`, and the namespaces below.

The constructor does not fail when a value is missing. A call that needs the slug raises `LumoAuthConfigError`. A call without any credential gets `401` from LumoAuth.

Environment variables that the package reads:

| Variable | Read by |
|---|---|
| `LUMOAUTH_URL`, `LUMOAUTH_ORG_ID` | `LumoAuth` and `LumoAuthAgent` |
| `LUMOAUTH_API_KEY` | `LumoAuth` |
| `AGENT_CLIENT_ID`, `AGENT_CLIENT_SECRET` | `LumoAuthAgent` |

## Credentials and what they may call

| Call | API key (`lmk_...`) | User access token |
|---|---|---|
| `permissions.check*` about the caller | yes | yes |
| `permissions.check*` with `user_id` or `agent_id` | with the `authz:check` scope | with the `authz:check` scope or the `authz.check` permission |
| `permissions.list()`, `list_slugs()` | no (`403`) | needs the `authz:read` scope |
| `zanzibar.check` about the caller | yes | yes |
| `zanzibar.check` about another subject, `zanzibar.expand` | with `authz:check` | with `authz:check` or `authz.check` |
| `abac.*` checks and reads | no (`401`) | needs `abac:read` |
| `abac.set_*` | no | needs `abac:write` and the `abac.manage` permission |
| `auth.userinfo()` | no | yes; the token needs the `openid` scope |
| `agents`, `approvals`, `jit` | no | see the agent skills |

The `auth` token calls (`exchange_code`, `refresh_token`, `client_credentials`, `token_exchange`, `revoke`) never send the client's credential. They authenticate with the client ID and secret that you pass.

Agent credentials (a client-credentials token of an agent, or an agent key) are accepted on the agent routes and on ABAC. LumoAuth checks the agent's capabilities instead of scopes. The agent skills cover them.

The blanket `admin` scope on a user token satisfies `authz:read`, `abac:read` and `abac:write`.

## `client.permissions` (RBAC)

| Method | Returns |
|---|---|
| `check(permission, context=None, *, user_id=None, agent_id=None)` | `bool` |
| `check_detailed(permission, context=None, *, user_id=None, agent_id=None)` | `dict` with `allowed` and the subject |
| `check_bulk(permissions, context=None, *, user_id=None, agent_id=None)` | `dict`; `results` maps each slug to a `bool` |
| `check_any(permissions, context=None, *, user_id=None, agent_id=None)` | `bool`: at least one is held |
| `check_all(permissions, context=None, *, user_id=None, agent_id=None)` | `bool`: every one is held |
| `check_any_detailed(...)`, `check_all_detailed(...)` | `dict` with `allowed` |
| `list()` | `dict` with `permissions`: a list of `{"slug", "description", "source"}` |
| `list_slugs()` | `set` of slugs |

- `user_id` is a LumoAuth user ID (the `sub` claim). `agent_id` is an agent ID (`agt_...`). Passing both raises `LumoAuthValidationError`.
- Without either, the check answers for the principal behind the credential. For an API key that is the admin who created the key.
- `context` is an optional dict with attributes for the decision.
- An empty permission list raises `LumoAuthValidationError`.
- A subject that is not in the organization gives `LumoAuthNotFoundError` with the code `SUBJECT_NOT_FOUND`.

## `client.zanzibar` (ReBAC)

| Method | Returns |
|---|---|
| `check(object, relation, subject)` | `bool` |
| `check_detailed(object, relation, subject)` | `dict` |
| `expand(object, relation)` | The tree of subjects that have the relation: `{"type": "union" \| "intersection" \| "leaf", "object", "relation", "children", "subjects"}` |
| `is_viewer(object, subject)`, `is_editor(...)`, `is_owner(...)`, `is_member(...)`, `is_admin(...)` | `bool`, for the relations `viewer`, `editor`, `owner`, `member`, `admin` |

`object` and `subject` have the form `namespace:id`, for example `document:readme` and `user:{user id}`. A subject can be a userset such as `team:platform#member`. A value without a colon raises `LumoAuthValidationError` before any request.

## `client.abac` (ABAC)

| Method | Returns |
|---|---|
| `check(resource_type, action, resource_id=None, context=None)` | `dict` with `allowed`, `reason`, `matchedPolicies` |
| `is_allowed(resource_type, action, resource_id=None, context=None)` | `bool` |
| `check_bulk(requests, environment=None)` | `{"results": [...]}`. At most 100 items. Each item is a dict with `resource_type`, `action` and optional `resource_id` |
| `get_my_attributes()` | The caller's attributes |
| `set_user_attribute(user_id, attribute_slug, value)` | |
| `get_resource_attributes(resource_type, resource_id)` | The resource's attributes |
| `set_resource_attribute(resource_type, resource_id, attribute_slug, value)` | |
| `get_attribute_definitions(type=None)` | A list. `type` is `"user"`, `"resource"` or `"environment"` |

`context` holds environment attributes for the policies; the client sends it as the request's `environment`. LumoAuth sets `ip`, `userAgent`, `requestMethod` and `requestPath` itself from the request that it received. To pass the end user's IP address, send `context={"pep": {"ip": "..."}}` and write policies against `pep.ip`. A bulk call applies one environment to every item.

## `client.auth` (OAuth 2.0 and OpenID Connect)

| Method | Purpose |
|---|---|
| `authorization_url(*, client_id, redirect_uri, scope="openid profile email", state=None, response_type="code", code_challenge=None, code_challenge_method=None, prompt=None, access_type=None, extra=None)` | Builds the URL of the authorization endpoint. No request is sent. With `code_challenge`, the method defaults to `S256`. `extra` is a dict of further query parameters, for example `{"resource": "https://api.example.com"}` |
| `exchange_code(code, redirect_uri, *, client_id, client_secret=None, code_verifier=None, dpop=None)` | Exchanges the authorization code. Returns the token response as a dict: `access_token`, `token_type`, `expires_in`, and when issued `refresh_token`, `id_token`, `scope` |
| `refresh_token(refresh_token, *, client_id, client_secret=None, scopes=None, dpop=None)` | Refresh grant. Keep the new `refresh_token` when the response has one |
| `client_credentials(client_id, client_secret=None, scopes=None, dpop=None, *, client_assertion=None)` | Client-credentials grant. Pass exactly one of `client_secret` and `client_assertion` |
| `token_exchange(subject_token, *, actor_token=None, audience=None, scopes=None, subject_token_type=..., actor_token_type=..., resource=None, dpop=None)` | Token exchange. `resource` becomes the `aud` of the new token. See `lumoauth-agent-delegation` |
| `revoke(token, *, token_type_hint=None, client_id=None, client_secret=None)` | Revokes an access or refresh token. Pass the client ID, and the secret of a confidential client |
| `userinfo(access_token=None)` | UserInfo claims. Pass `access_token`, or create the client with a `token_provider` |

There is no PKCE helper and no session handling: the app creates the verifier, the challenge and `state`, and stores them between the two requests. `SKILL.md` shows the code. There is no helper for the end-session (logout) URL either; build it as shown in [flask-django-sign-in.md](flask-django-sign-in.md).

## Agent namespaces

These namespaces serve code that acts as an AI agent. Most of their calls need an agent credential, and LumoAuth rejects API keys on them. Agent code normally uses `LumoAuthAgent`, which signs in with `AGENT_CLIENT_ID` and `AGENT_CLIENT_SECRET` and renews its token.

| Namespace | Methods | Skill |
|---|---|---|
| `client.agents` | `ask(action, context=None)`, `is_allowed(action, context=None)`, `me()`, `info()`, `capabilities()`, `budget()`, `report_usage(tokens=0, cost_usd=0.0)`, `authorize_mcp_tool(server_id, tool)`, `register(...)` | `lumoauth-agent-identity` |
| `client.approvals` | `create(...)`, `get_status(token)`, `wait(token, ...)`, `require(*, task_id, reason, on_behalf_of, impact="medium", meta=None, poll_interval_s=1.5, timeout_s=90.0)` | `lumoauth-agent-approvals` |
| `client.jit` | `create_task(*, name=None, task_type=None, on_behalf_of=None)`, `complete_task(task_id)`, `evaluate_task(task_id, ...)`, `request(task_id, authorization_details, *, justification=None, ttl=300)`, `get_status(request_id)`, `get_token(request_id)`, `pending()` | `lumoauth-agent-approvals` |
| `client.delegation` | `consent_url(*, client_id, redirect_uri, scopes=None, state=None)`, `exchange_code(...)`, `refresh_user_token(...)`, `exchange(subject_token, actor_token, scopes=None, *, resource=None)`, `revoke(...)`, `parse_actor_chain(token)`, `get_subject(token)` | `lumoauth-agent-delegation` |
| `client.mcp` | `get_token(server_id, *, subject_token=None, dpop=None)`, `exchange(...)`, `authorize_tool(server_id, subject_type, subject_id, tool, *, traceparent=None)` | `lumoauth-mcp-client`, `lumoauth-mcp-server` |

Other top-level exports for agents: `LumoAuthAgent`, `DelegationChain`, `JITContext`, `AAuthClient`, `require_approval`, `require_capability`, `ClientAssertionSigner`, `DpopKey`, `DpopProofSigner`.

## `client.api`

The generated OpenAPI client, configured with the same base URL and credential. See [tokens-and-machine-access.md](tokens-and-machine-access.md).

## Errors

```
LumoAuthError                         .message, .code
├── LumoAuthApiError                  any non-2xx answer: .status_code, .body
│   ├── LumoAuthAuthenticationError   401
│   ├── LumoAuthPermissionDeniedError 403; .required_scopes
│   ├── LumoAuthNotFoundError         404
│   └── LumoAuthRateLimitError        429; .retry_after (seconds, or None)
├── LumoAuthValidationError           bad input or an unexpected answer; .issues
│   └── LumoAuthTokenError            local token verification failed; .code, .error, .www_authenticate
├── LumoAuthConfigError               missing or invalid configuration
├── LumoAuthNetworkError              no HTTP answer: DNS, TLS, timeout; .cause
├── LumoAuthApprovalDeniedError       agent approvals
├── LumoAuthApprovalTimeoutError      agent approvals
├── LumoAuthApprovalNotDeliveredError agent approvals; .reason, .task_id
└── LumoAuthBudgetExceededError       agent budgets
```

All are importable from `lumoauth`.

- `code` is the `code` field of the answer, or its `error` field, or the class default (`AUTHENTICATION_ERROR`, `PERMISSION_DENIED`, `NOT_FOUND`, `RATE_LIMITED`, `API_ERROR`). Examples: `INSUFFICIENT_PERMISSIONS`, `SUBJECT_NOT_FOUND`, `forbidden`, `invalid_grant`, `invalid_client`.
- `message` comes from `error_description`, `message`, `detail` or `error` of the answer.
- `body` is the decoded answer. Do not return it to end users unchanged.
- A missing scope gives `LumoAuthPermissionDeniedError` whose `required_scopes` lists the scopes that LumoAuth named. For any other `403` the list is empty.

Older code can keep its `except` clauses: `LumoAuthApiError` is also a `RuntimeError`, `LumoAuthConfigError` and `LumoAuthValidationError` are also a `ValueError`, and `LumoAuthNetworkError` is also a `ConnectionError`.

```python
from lumoauth import (
    LumoAuth,
    LumoAuthApiError,
    LumoAuthAuthenticationError,
    LumoAuthConfigError,
    LumoAuthNetworkError,
    LumoAuthPermissionDeniedError,
)

lumo = LumoAuth()


def explain_failure(permission: str, user_id: str) -> str:
    try:
        return "allowed" if lumo.permissions.check(permission, user_id=user_id) else "denied"
    except LumoAuthConfigError as err:
        return f"configuration: {err.message}"
    except LumoAuthAuthenticationError:
        return "the credential is missing, wrong or expired"
    except LumoAuthPermissionDeniedError as err:
        if err.required_scopes:
            return f"missing scopes: {', '.join(err.required_scopes)}"
        return f"refused: {err.code}"
    except LumoAuthApiError as err:
        return f"LumoAuth answered HTTP {err.status_code} ({err.code})"
    except LumoAuthNetworkError:
        return "LumoAuth could not be reached"
```
