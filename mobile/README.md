# Sombra mobile (Expo)

Expo SDK 54, React Native, and Expo Router (tabs). Lives under `mobile/` in the monorepo.

## Setup

From the **repository root**:

```bash
npm install
```

Copy environment template and set your API URL:

```bash
cp mobile/.env.example mobile/.env
```

Edit `mobile/.env` so `EXPO_PUBLIC_API_URL` points at your running backend (see comments in `.env.example`). The backend defaults to port **3001** (`PORT` in `backend/.env`).

If you use **Expo web**, ensure `FRONTEND_ORIGIN` / CORS on the backend allows the Expo web dev origin (native iOS/Android requests are not subject to browser CORS).

Start Metro:

```bash
npm run mobile:start
```

Or from `mobile/`: `npm run start`.

## UI (gluestack-ui v3)

The app uses [gluestack-ui v3](https://gluestack.io/ui/docs/home/overview/introduction) with NativeWind/Tailwind. Primitives live under `components/ui/` (for example `box`, `text`, `button`, `input`). The root tree is wrapped with `GluestackUIProvider` in `app/_layout.tsx`, with light/dark mode aligned to the device color scheme.

To add more building blocks from the catalog, run from `mobile/`:

```bash
npx gluestack-ui add <component-name>
```

See the [gluestack-ui docs](https://gluestack.io/) for components and styling.

## Monorepo

The root `package.json` defines npm workspaces (`frontend`, `backend`, `mobile`, `packages/*`). Shared auth types and API path constants live in `@sombra/shared` (`packages/shared`).

## EAS Build and Update

1. Install the EAS CLI: `npm i -g eas-cli`
2. Log in: `eas login`
3. In `mobile/`, run `eas build:configure` once to link the project (creates/updates `eas.json` and Expo project settings).
4. **Build**: `eas build --platform android` / `eas build --platform ios` (iOS requires Apple Developer credentials).
5. **OTA updates** (JavaScript-only): `eas update --branch production` after configuring [EAS Update](https://docs.expo.dev/eas-update/introduction/). Store policy still applies to what you may ship without review.

See [Expo EAS](https://docs.expo.dev/build/introduction/) for full documentation.

## Deep linking

The app scheme is configured in `app.json` (`expo.scheme`). Use `expo-linking` when you add password reset or OAuth callbacks that must return to the app.

## iOS

Local iOS builds require macOS with Xcode, or use **EAS Build** cloud builders. Expo Go on a physical iPhone can load the dev server for day-to-day development.
