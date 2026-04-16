-- DnD confirm: wrap from/to in <loc> for Trans + blue highlight in UI.
INSERT INTO ui_translations (locale, msg_key, value)
VALUES
  ('en', 'common.dnd_confirm_move_msg', 'Are you sure you want to move {{subject}} from <loc>{{from}}</loc> to <loc>{{to}}</loc>?'),
  ('de', 'common.dnd_confirm_move_msg', 'Möchten Sie {{subject}} wirklich von <loc>{{from}}</loc> nach <loc>{{to}}</loc> verschieben?')
ON CONFLICT (locale, msg_key) DO UPDATE SET value = EXCLUDED.value;
