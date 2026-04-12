/**
 * Bridges @types/react 19 JSX expectations with React Native host components
 * until RN typings align with React 19.
 */
import type {
  ComponentType,
  ForwardRefExoticComponent,
  ReactElement,
  RefAttributes,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
  type ActivityIndicatorProps,
  type FlatListProps,
  type KeyboardAvoidingViewProps,
  type ModalProps,
  type PressableProps,
  type RefreshControlProps,
  type ScrollViewProps,
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native';

/** Ref + optional NativeWind `className` on RN hosts (Gluestack / NativeWind). */
type NativeWindHost<P> = ForwardRefExoticComponent<
  P & { className?: string } & RefAttributes<unknown>
>;

export const RNKeyboardAvoidingView =
  KeyboardAvoidingView as unknown as ComponentType<KeyboardAvoidingViewProps>;
export const RNTextInput = TextInput as unknown as NativeWindHost<TextInputProps>;
export const RNActivityIndicator =
  ActivityIndicator as unknown as NativeWindHost<ActivityIndicatorProps>;
export const RNText = Text as unknown as NativeWindHost<TextProps>;
export const RNView = View as unknown as NativeWindHost<ViewProps>;
export const RNScrollView =
  ScrollView as unknown as ComponentType<ScrollViewProps>;
/** Casts around RN × React 19 typings; item type comes from `data` at usage. */
export const RNFlatList = FlatList as unknown as <T>(
  props: FlatListProps<T>,
) => ReactElement | null;
export const RNModal = Modal as unknown as ComponentType<ModalProps>;
export const RNRefreshControl =
  RefreshControl as unknown as ComponentType<RefreshControlProps>;
export const RNPressable =
  Pressable as unknown as NativeWindHost<PressableProps>;
