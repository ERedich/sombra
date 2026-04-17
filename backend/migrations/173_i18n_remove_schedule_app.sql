-- Schedule app removed from frontend; drop nav + schedule.* strings.

DELETE FROM ui_translations
WHERE msg_key = 'nav.schedule'
   OR msg_key LIKE 'schedule.%';
