import { Redirect, type Href } from 'expo-router';

/** @deprecated Use the Copilot tab. */
export default function CreateVoiceRedirect() {
  return <Redirect href={'/copilot' as Href} />;
}
