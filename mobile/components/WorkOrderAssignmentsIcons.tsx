import FontAwesome from '@expo/vector-icons/FontAwesome';
import { StyleSheet } from 'react-native';

import { RNPressable, RNView } from '@/lib/rnJsx';

const ICON_SIZE = 18;
const PRIMARY = '#2563eb';
const GREEN_400 = '#4ade80';
const GREEN_500 = '#22c55e';
const MUTED = '#64748b';

export type WorkOrderAssignmentIconKind =
  | 'material'
  | 'employee'
  | 'instructions'
  | 'notification';

export type WorkOrderAssignmentIconRow = {
  has_material_assignment?: boolean;
  has_employee_assignment?: boolean;
  work_instruction_count?: number;
  work_instruction_done_count?: number;
  has_notification_assignment?: boolean;
};

type Props = {
  row: WorkOrderAssignmentIconRow;
  showNotificationIcon?: boolean;
  onPress?: (kind: WorkOrderAssignmentIconKind) => void;
};

/** Assignment indicators aligned with the web WorkAssignmentsIcons behaviour. */
export function WorkOrderAssignmentsIcons({
  row,
  showNotificationIcon = false,
  onPress,
}: Props) {
  const material = row.has_material_assignment === true;
  const employee = row.has_employee_assignment === true;
  const total = row.work_instruction_count ?? 0;
  const done = row.work_instruction_done_count ?? 0;
  const instructions = total > 0;
  const allInstructionsDone = instructions && done === total;
  const notification = row.has_notification_assignment === true;

  return (
    <RNView style={styles.row}>
      <RNPressable
        accessibilityLabel="Material assignment"
        hitSlop={8}
        style={[styles.hit, { opacity: material ? 1 : 0.2 }]}
        onPress={() => onPress?.('material')}>
        <FontAwesome
          name="cube"
          size={ICON_SIZE}
          color={material ? PRIMARY : MUTED}
        />
      </RNPressable>
      <RNPressable
        accessibilityLabel="Employee assignment"
        hitSlop={8}
        style={[styles.hit, { opacity: employee ? 1 : 0.2 }]}
        onPress={() => onPress?.('employee')}>
        <FontAwesome
          name="user"
          size={ICON_SIZE}
          color={employee ? GREEN_500 : MUTED}
        />
      </RNPressable>
      <RNPressable
        accessibilityLabel={
          instructions
            ? `Work instructions ${done} of ${total} done`
            : 'Work instructions'
        }
        hitSlop={8}
        style={[styles.hit, { opacity: instructions ? 1 : 0.2 }]}
        onPress={() => onPress?.('instructions')}>
        <FontAwesome
          name="list"
          size={ICON_SIZE}
          color={
            !instructions
              ? MUTED
              : allInstructionsDone
                ? GREEN_400
                : PRIMARY
          }
        />
      </RNPressable>
      {showNotificationIcon ? (
        <RNPressable
          accessibilityLabel={
            notification ? 'Subscribed to notifications' : 'Subscribe to notifications'
          }
          hitSlop={8}
          style={[styles.hit, { opacity: notification ? 1 : 0.2 }]}
          onPress={() => onPress?.('notification')}>
          <FontAwesome
            name="bell"
            size={ICON_SIZE}
            color={notification ? GREEN_400 : MUTED}
          />
        </RNPressable>
      ) : null}
    </RNView>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 14,
  },
  hit: {
    padding: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
