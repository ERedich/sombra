import { Stack } from 'expo-router';

export default function AssetsStackLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Assets' }} />
      <Stack.Screen name="[id]" options={{ title: 'Asset' }} />
    </Stack>
  );
}
