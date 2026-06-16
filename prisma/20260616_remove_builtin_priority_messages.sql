DELETE FROM tablet_priority_message_schedule_targets
WHERE schedule_id IN (
    SELECT id
    FROM tablet_priority_message_schedules
    WHERE template_id IN ('evac', 'dzien_rektorski')
);

DELETE FROM tablet_priority_message_schedules
WHERE template_id IN ('evac', 'dzien_rektorski');

DELETE FROM tablet_priority_message_presets
WHERE id IN ('preset-evacuation', 'preset-rectors-day')
   OR template_id IN ('evac', 'dzien_rektorski');

DELETE FROM tablet_priority_message_manual_assignments
WHERE template_id IN ('evac', 'dzien_rektorski');

DELETE FROM tablet_priority_message_assignments
WHERE template_id IN ('evac', 'dzien_rektorski');

DELETE FROM tablet_priority_message_templates
WHERE id IN ('evac', 'dzien_rektorski');
