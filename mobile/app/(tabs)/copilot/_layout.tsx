import { Stack } from 'expo-router';

export default function CopilotStackLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Kira' }} />
    </Stack>
  );
}
