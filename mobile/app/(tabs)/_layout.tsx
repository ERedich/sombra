import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Tabs } from 'expo-router';

import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import Colors from '@/constants/Colors';
import { MobileIdleSession } from '@/components/MobileIdleSession';
import { WoAppSettingsProvider } from '@/context/WoAppSettingsContext';

function TabBarIcon(props: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: string;
}) {
  return <FontAwesome size={24} style={{ marginBottom: -2 }} {...props} />;
}

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <WoAppSettingsProvider>
      <MobileIdleSession>
      <Tabs
        screenOptions={{
          tabBarActiveTintColor: Colors[colorScheme ?? 'light'].tint,
          headerShown: useClientOnlyValue(false, true),
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color }) => (
              <TabBarIcon name="home" color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="copilot"
          options={{
            title: 'Kira',
            headerShown: false,
            tabBarIcon: ({ color }) => (
              <TabBarIcon name="magic" color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="work-orders"
          options={{
            title: 'Work orders',
            headerShown: false,
            tabBarIcon: ({ color }) => (
              <TabBarIcon name="wrench" color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="assets"
          options={{
            title: 'Assets',
            headerShown: false,
            tabBarIcon: ({ color }) => (
              <TabBarIcon name="cubes" color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="notifications"
          options={{
            title: 'Notifications',
            tabBarIcon: ({ color }) => (
              <TabBarIcon name="bell" color={color} />
            ),
          }}
        />
      </Tabs>
      </MobileIdleSession>
    </WoAppSettingsProvider>
  );
}
