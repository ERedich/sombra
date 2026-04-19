-- Seed 10 Probleme, 10 Ursachen, 10 Maßnahmen für den aktuell ersten Standort.
-- Idempotent: nur einfügen, wenn der Zielstandort noch keine PCR-Stammdaten hat.
-- Verknüpfung round-robin: Ursache i -> Problem ((i-1) mod 10)+1, Maßnahme i -> Ursache ((i-1) mod 10)+1
-- Hier 1:1 (je Cause ein Problem, je Remedy eine Cause) als sinnvoller Default.

DO $$
DECLARE
  target_site_id UUID;
BEGIN
  SELECT id INTO target_site_id
  FROM sites
  ORDER BY created_at ASC NULLS LAST, id ASC
  LIMIT 1;

  IF target_site_id IS NULL THEN
    RAISE NOTICE 'No site found; skipping PCR seed.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM pcr_problems WHERE site_id = target_site_id) THEN
    RAISE NOTICE 'PCR data already present for site %, skipping.', target_site_id;
    RETURN;
  END IF;

  -- Probleme
  INSERT INTO pcr_problems (site_id, key, name, description) VALUES
    (target_site_id, 'P01', 'Maschinenstillstand',       'Anlage bleibt unerwartet stehen'),
    (target_site_id, 'P02', 'Lärmentwicklung',           'Ungewöhnliche Geräusche im Betrieb'),
    (target_site_id, 'P03', 'Überhitzung',               'Temperatur über Grenzwert'),
    (target_site_id, 'P04', 'Leckage',                   'Austritt von Flüssigkeit / Schmierstoff'),
    (target_site_id, 'P05', 'Qualitätsabweichung',       'Produkt entspricht nicht Spezifikation'),
    (target_site_id, 'P06', 'Vibration',                 'Erhöhte Schwingungen an der Anlage'),
    (target_site_id, 'P07', 'Stromausfall',              'Ausfall der elektrischen Versorgung'),
    (target_site_id, 'P08', 'Materialstau',              'Blockierung im Materialfluss'),
    (target_site_id, 'P09', 'Sensorfehler',              'Sensorik liefert falsche Werte'),
    (target_site_id, 'P10', 'Schmierstoffmangel',        'Zu wenig Schmierstoff vorhanden');

  -- Ursachen (eine je Problem, ID-Zuordnung via key)
  INSERT INTO pcr_causes (site_id, problem_id, key, name, description)
  SELECT target_site_id, p.id, v.key, v.name, v.description
  FROM (VALUES
    ('P01', 'U01', 'Verschleiß Antriebselement', 'Lager oder Riemen verschlissen'),
    ('P02', 'U02', 'Unwucht Rotor',              'Rotor aus dem Gleichgewicht'),
    ('P03', 'U03', 'Kühlung defekt',             'Lüfter oder Kühlmittelkreis gestört'),
    ('P04', 'U04', 'Dichtung defekt',            'Dichtring oder Flansch undicht'),
    ('P05', 'U05', 'Werkzeug verschlissen',      'Schneidkante / Werkzeug abgenutzt'),
    ('P06', 'U06', 'Lockere Verschraubung',      'Schrauben nicht korrekt angezogen'),
    ('P07', 'U07', 'Sicherung ausgelöst',        'Überstrom-Schutz aktiv'),
    ('P08', 'U08', 'Fehleinlage',                'Material falsch eingelegt'),
    ('P09', 'U09', 'Sensor verschmutzt',         'Sensor durch Ablagerungen beeinträchtigt'),
    ('P10', 'U10', 'Nachschmierung versäumt',    'Wartungsplan nicht eingehalten')
  ) AS v(problem_key, key, name, description)
  JOIN pcr_problems p ON p.site_id = target_site_id AND p.key = v.problem_key;

  -- Maßnahmen (eine je Ursache)
  INSERT INTO pcr_remedies (site_id, cause_id, key, name, description)
  SELECT target_site_id, c.id, v.key, v.name, v.description
  FROM (VALUES
    ('U01', 'M01', 'Antriebselement tauschen',  'Defektes Lager / Riemen ersetzen'),
    ('U02', 'M02', 'Rotor auswuchten',          'Rotor dynamisch auswuchten'),
    ('U03', 'M03', 'Kühlsystem instand setzen', 'Lüfter / Kühlmittel prüfen und tauschen'),
    ('U04', 'M04', 'Dichtung erneuern',         'Dichtring / Flanschdichtung wechseln'),
    ('U05', 'M05', 'Werkzeug tauschen',         'Werkzeug wechseln und kalibrieren'),
    ('U06', 'M06', 'Verschraubung nachziehen',  'Schrauben mit Drehmomentschlüssel anziehen'),
    ('U07', 'M07', 'Sicherung zurücksetzen',    'Ursache prüfen, Sicherung zurücksetzen'),
    ('U08', 'M08', 'Material korrekt einlegen', 'Einlegen nach Arbeitsanweisung'),
    ('U09', 'M09', 'Sensor reinigen',           'Sensor gemäß Vorgabe reinigen'),
    ('U10', 'M10', 'Schmierung durchführen',    'Nach Wartungsplan nachschmieren')
  ) AS v(cause_key, key, name, description)
  JOIN pcr_causes c ON c.site_id = target_site_id AND c.key = v.cause_key;
END $$;
