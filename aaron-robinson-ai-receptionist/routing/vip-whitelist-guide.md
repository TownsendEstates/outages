# VIP Whitelist: Setup and Updates

The VIP list lives in Supabase and is edited from a phone-friendly admin page. No code changes and no Ulio changes are needed to add, edit, pause or remove a VIP. Changes apply to the very next call.

## Open the admin page

- URL: `https://<NETLIFY-SITE>/admin/` (bookmark it on Aaron's home screen: Safari > Share > Add to Home Screen)
- PIN: Aaron gets his own PIN (`AARON_PIN`). Scott's admin PIN is separate. Five wrong PINs lock the page for 15 minutes.

## Add a VIP

1. Tap **VIP list** > **Add VIP**.
2. **What the AI calls them:** the name the AI says out loud, for example "Mom", "Scott", "Dave".
3. **Full name** (optional), **Phone** (any format, for example 780.555.0100), **Relationship**.
4. **Priority:**
   - High: the AI takes a priority message and texts Aaron instantly.
   - Critical: the same, plus the AI tries a live transfer.
5. **Log their calls in Follow Up Boss:** leave OFF for family and personal contacts. Turn ON for business partners who are also clients or referral partners.
6. **Save.**
7. **Add the same person to Favourites (iPhone) or Starred (Android)** so they ring through Focus and Do Not Disturb.

## Edit, pause or remove

Tap **Edit** next to the person. Untick **Active** to pause them without deleting, or tap **Remove**.

## Starting list

| What the AI calls them | Full name | Phone | Relationship | Priority | Log in FUB |
|---|---|---|---|---|---|
| Scott | Scott Townsend | 587.200.4953 | Business partner / AI line admin | High | No |
| Mom | `[Aaron to add]` | `[number]` | Family | Critical | No |
| `[Partner 1]` | `[name]` | `[number]` | Business partner | High | `[Aaron to choose]` |
| `[Partner 2]` | `[name]` | `[number]` | Business partner | High | `[Aaron to choose]` |

Scott is preloaded by the database setup. Aaron adds the rest himself from the admin page (best practice: he enters his own family's numbers, so Scott never handles them).

## Bulk load (Scott only, optional)

In Supabase > SQL editor:

```sql
insert into vip_contacts (display_name, full_name, relationship, phone_e164, priority, sync_to_crm)
values ('Mom', 'FULL NAME', 'Family', '+1780XXXXXXX', 'critical', false)
on conflict (phone_e164) do update set display_name = excluded.display_name, priority = excluded.priority;
```

## Privacy note

VIP numbers are personal information of people who never called the business. They are stored only in the locked-down Supabase table, never sent to Follow Up Boss unless "Log in FUB" is on, and never read aloud by the AI.
