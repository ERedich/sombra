/**
 * API origin without trailing slash (e.g. `http://localhost:4000`).
 * Android emulator: use `http://10.0.2.2:<port>` to reach the host machine.
 */
export const apiBaseUrl = process.env.EXPO_PUBLIC_API_URL ?? '';
