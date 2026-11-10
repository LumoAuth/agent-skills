# Modelling relationships: patterns, schema rules and limits

Patterns for the LumoAuth relationship model, each with the namespace schema and example tuples. An administrator enters namespaces and tuples in the portal (**Access control → Relationships**). No API writes them.

In every example, `<alice>` and `<bob>` stand for LumoAuth user IDs (the UUID in the `sub` claim).

## Schema rules

A namespace schema is a JSON object with exactly one top-level key, `relations`. Any other top-level key is rejected. Each entry maps a relation name to one rewrite.

| Rewrite | Shape | Evaluates to |
|---|---|---|
| Direct | `{"_this": {"relation": "R"}}` | Subjects in stored tuples `object#R@subject`. `R` is normally the relation's own name. A subject that is a userset (`team:x#member`) is followed |
| Computed userset | `{"computed_userset": {"relation": "R"}}` | Everyone who has relation `R` on the same object |
| Tuple to userset | `{"tuple_to_userset": {"tupleset": {"relation": "P"}, "computed_userset": {"relation": "R"}}}` | For each tuple `object#P@other`, everyone who has relation `R` on `other` |
| Union | `{"union": [rewrite, rewrite, ...]}` | Any branch |
| Intersection | `{"intersection": [rewrite, rewrite, ...]}` | Every branch. An empty list grants nothing |

More rules:

- A namespace needs at least one relation.
- Namespace names match `^[a-z][a-z0-9_]*$`. `permission` and `role` are reserved for the platform, as an object namespace and as a subject namespace.
- A `_this` rewrite without a `relation` value matches nothing.
- A relation that is not in the schema is never granted, even when a tuple with that relation name is stored.
- Keep rewrites shallow. The portal rejects a rewrite that is nested more than a few levels deep.
- There is no exclusion ("everyone but") rewrite.

## Pattern: ownership

The owner can do everything that an editor or a viewer can.

```json
{
  "relations": {
    "owner": { "_this": { "relation": "owner" } },
    "editor": {
      "union": [
        { "computed_userset": { "relation": "owner" } },
        { "_this": { "relation": "editor" } }
      ]
    },
    "viewer": {
      "union": [
        { "computed_userset": { "relation": "editor" } },
        { "_this": { "relation": "viewer" } }
      ]
    }
  }
}
```

```
project:apollo#owner@user:<alice>
project:apollo#viewer@user:<bob>
```

Checks: `project:apollo#editor@user:<alice>` is allowed (owner implies editor). `project:apollo#editor@user:<bob>` is denied.

In code, check the weakest relation that the action needs. Do not check `owner` and `editor` and `viewer` in turn.

## Pattern: teams (grant to a group of users)

Namespace `team`:

```json
{ "relations": { "member": { "_this": { "relation": "member" } } } }
```

```
team:platform#member@user:<alice>
team:platform#member@user:<bob>
project:apollo#editor@team:platform#member
```

In the portal's **Add relationship** form, the last tuple is: object namespace `project`, object ID `apollo`, relation `editor`, user namespace `team`, user ID `platform`, user relation `member`.

Adding a user to the team gives access to everything that the team has. Removing the member tuple takes it away. Prefer one team tuple to one tuple per user.

To add team leads who are also members:

```json
{
  "relations": {
    "lead": { "_this": { "relation": "lead" } },
    "member": {
      "union": [
        { "computed_userset": { "relation": "lead" } },
        { "_this": { "relation": "member" } }
      ]
    }
  }
}
```

## Pattern: folders and parents (inherited access)

A document inherits viewers and editors from its folder. The document stores a `parent` tuple whose subject is the folder.

Namespace `document`:

```json
{
  "relations": {
    "parent": { "_this": { "relation": "parent" } },
    "owner": { "_this": { "relation": "owner" } },
    "editor": {
      "union": [
        { "computed_userset": { "relation": "owner" } },
        { "_this": { "relation": "editor" } },
        {
          "tuple_to_userset": {
            "tupleset": { "relation": "parent" },
            "computed_userset": { "relation": "editor" }
          }
        }
      ]
    },
    "viewer": {
      "union": [
        { "computed_userset": { "relation": "editor" } },
        { "_this": { "relation": "viewer" } },
        {
          "tuple_to_userset": {
            "tupleset": { "relation": "parent" },
            "computed_userset": { "relation": "viewer" }
          }
        }
      ]
    }
  }
}
```

Namespace `folder`: the ownership schema above (with `owner`, `editor`, `viewer`). For nested folders, add `parent` and the same `tuple_to_userset` branches to the `folder` namespace.

```
folder:finance#viewer@team:finance#member
document:q4-report#parent@folder:finance
```

Check `document:q4-report#viewer@user:<bob>`: allowed when Bob is a member of `team:finance`.

Both namespaces must define the relation that the `tuple_to_userset` names (`viewer` on `folder` here). Keep parent chains short: see the limits below.

## Pattern: workspace or tenant-level resources

Every project belongs to a workspace. Workspace admins can edit every project, and workspace members can view.

Namespace `workspace`:

```json
{
  "relations": {
    "admin": { "_this": { "relation": "admin" } },
    "member": {
      "union": [
        { "computed_userset": { "relation": "admin" } },
        { "_this": { "relation": "member" } }
      ]
    }
  }
}
```

Namespace `project`:

```json
{
  "relations": {
    "workspace": { "_this": { "relation": "workspace" } },
    "editor": {
      "union": [
        { "_this": { "relation": "editor" } },
        {
          "tuple_to_userset": {
            "tupleset": { "relation": "workspace" },
            "computed_userset": { "relation": "admin" }
          }
        }
      ]
    },
    "viewer": {
      "union": [
        { "computed_userset": { "relation": "editor" } },
        { "_this": { "relation": "viewer" } },
        {
          "tuple_to_userset": {
            "tupleset": { "relation": "workspace" },
            "computed_userset": { "relation": "member" }
          }
        }
      ]
    }
  }
}
```

```
workspace:acme#admin@user:<alice>
workspace:acme#member@user:<bob>
project:api-v2#workspace@workspace:acme
```

## Pattern: sharing with one user

A direct tuple is a share:

```
document:q4-report#viewer@user:<bob>
```

An administrator adds and revokes it in the portal. When end users of the application share objects with each other at run time, LumoAuth cannot store those shares, because no API writes tuples. Store run-time shares in the application database and combine the two answers in the application: allow when the application's own share table allows, or when the LumoAuth check allows.

## Pattern: both conditions (intersection)

A user may approve an invoice only when the user is an approver of the invoice and a member of its cost centre.

```json
{
  "relations": {
    "approver": { "_this": { "relation": "approver" } },
    "cost_centre": { "_this": { "relation": "cost_centre" } },
    "can_approve": {
      "intersection": [
        { "computed_userset": { "relation": "approver" } },
        {
          "tuple_to_userset": {
            "tupleset": { "relation": "cost_centre" },
            "computed_userset": { "relation": "member" }
          }
        }
      ]
    }
  }
}
```

```
invoice:1042#approver@user:<alice>
invoice:1042#cost_centre@cost_centre:emea
cost_centre:emea#member@user:<alice>
```

The `cost_centre` namespace defines `member`. Check `invoice:1042#can_approve@user:<alice>`.

## Naming advice

- Name relations as nouns for stored facts (`owner`, `member`, `parent`) and as `can_<verb>` for computed permissions when the two differ (`can_approve`).
- Use the same ID for an object in LumoAuth as in the application database.
- Use one namespace per object type. Do not encode the type in the ID.

## Limits of the engine

- A check visits each `object#relation@subject` node once and stops with a denial after 2,000 nodes.
- A check and an `expand` stop at a depth of 10. A check that runs out of depth is a denial.
- `expand` lists usersets as written and does not resolve them. A node that is revisited on the same path is returned as an empty leaf.
- `expand` of an unknown object or relation returns an empty leaf, not an error.
- There is no "list the objects that this user can access" call. Filter lists in the application: load candidates, then check each (in parallel, with a bound), or keep list filters on data that the application owns.
- A wildcard (`*`) is not accepted in an object ID or a user ID.

## Sync from roles

The **Tuples** tab has **Sync from roles**. It writes the organization's roles and permissions into the platform's reserved `permission` and `role` namespaces so that the unified permission check can use them. It does not create relationships for the application's own namespaces. Administrators cannot add tuples to the reserved namespaces by hand.
