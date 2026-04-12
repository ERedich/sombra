import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Link, Stack, type Href } from 'expo-router';
import { Pressable } from 'react-native';

export default function WorkOrdersStackLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: 'Work orders',
          headerRight: () => (
            <Link href={'/copilot' as Href} asChild>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open copilot"
                style={{ paddingHorizontal: 12, paddingVertical: 8 }}>
                <FontAwesome name="microphone" size={20} color="#2563eb" />
              </Pressable>
            </Link>
          ),
        }}
      />
      <Stack.Screen name="create-voice" options={{ title: 'Voice create' }} />
      <Stack.Screen name="[id]" options={{ title: 'Work order' }} />
    </Stack>
  );
}
