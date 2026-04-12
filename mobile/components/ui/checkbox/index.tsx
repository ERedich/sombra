'use client';
import React from 'react';
import { createCheckbox } from '@gluestack-ui/core/checkbox/creator';
import { tva, type VariantProps } from '@gluestack-ui/utils/nativewind-utils';

import { RNPressable, RNText, RNView } from '@/lib/rnJsx';

const UICheckbox = createCheckbox({
  Root: RNPressable,
  Indicator: RNView,
  Icon: RNText,
  Label: RNText,
  Group: RNView,
});

type NwProps = Record<string, unknown> & { className?: string };
const UICheckboxRoot = UICheckbox as unknown as React.ComponentType<NwProps>;
const UICheckboxIndicator =
  UICheckbox.Indicator as unknown as React.ComponentType<NwProps>;
const UICheckboxIcon = UICheckbox.Icon as unknown as React.ComponentType<NwProps>;
const UICheckboxLabel =
  UICheckbox.Label as unknown as React.ComponentType<NwProps>;
const UICheckboxGroup =
  UICheckbox.Group as unknown as React.ComponentType<NwProps>;

const checkboxRootStyle = tva({
  base: 'flex-row items-start gap-3',
});

const checkboxIndicatorStyle = tva({
  base:
    'mt-0.5 justify-center items-center border-2 border-outline-300 rounded-sm bg-background-0 h-[22px] w-[22px] data-[checked=true]:border-primary-600 data-[checked=true]:bg-primary-600 data-[disabled=true]:opacity-40',
});

const checkboxIconStyle = tva({
  base:
    'text-typography-0 font-bold text-sm leading-[14px] text-center w-full',
});

const checkboxLabelStyle = tva({
  base:
    'text-typography-900 flex-1 text-base leading-snug pt-0.5 data-[disabled=true]:opacity-40',
});

const checkboxGroupStyle = tva({
  base: 'gap-2',
});

type ICheckboxProps = Omit<
  React.ComponentPropsWithoutRef<typeof UICheckbox>,
  'context'
> &
  VariantProps<typeof checkboxRootStyle> & { className?: string };

const Checkbox = React.forwardRef<
  React.ElementRef<typeof UICheckbox>,
  ICheckboxProps
>(({ className, ...props }, ref) => (
  <UICheckboxRoot
    ref={ref}
    {...props}
    className={checkboxRootStyle({ class: className })}
  />
));

const CheckboxIndicator = React.forwardRef<
  React.ElementRef<typeof UICheckbox.Indicator>,
  React.ComponentPropsWithoutRef<typeof UICheckbox.Indicator> & {
    className?: string;
  }
>(({ className, ...props }, ref) => (
  <UICheckboxIndicator
    ref={ref}
    {...props}
    className={checkboxIndicatorStyle({ class: className })}
  />
));

const CheckboxIcon = React.forwardRef<
  React.ElementRef<typeof UICheckbox.Icon>,
  React.ComponentPropsWithoutRef<typeof UICheckbox.Icon> & {
    className?: string;
    children?: React.ReactNode;
  }
>(({ className, children = '✓', ...props }, ref) => (
  <UICheckboxIcon
    ref={ref}
    {...props}
    className={checkboxIconStyle({ class: className })}>
    {children}
  </UICheckboxIcon>
));

const CheckboxLabel = React.forwardRef<
  React.ElementRef<typeof UICheckbox.Label>,
  React.ComponentPropsWithoutRef<typeof UICheckbox.Label> & {
    className?: string;
  }
>(({ className, ...props }, ref) => (
  <UICheckboxLabel
    ref={ref}
    {...props}
    className={checkboxLabelStyle({ class: className })}
  />
));

type ICheckboxGroupProps = React.ComponentPropsWithoutRef<
  typeof UICheckbox.Group
> &
  VariantProps<typeof checkboxGroupStyle> & { className?: string };

const CheckboxGroup = React.forwardRef<
  React.ElementRef<typeof UICheckbox.Group>,
  ICheckboxGroupProps
>(({ className, ...props }, ref) => (
  <UICheckboxGroup
    ref={ref}
    {...props}
    className={checkboxGroupStyle({ class: className })}
  />
));

Checkbox.displayName = 'Checkbox';
CheckboxIndicator.displayName = 'CheckboxIndicator';
CheckboxIcon.displayName = 'CheckboxIcon';
CheckboxLabel.displayName = 'CheckboxLabel';
CheckboxGroup.displayName = 'CheckboxGroup';

export {
  Checkbox,
  CheckboxIndicator,
  CheckboxIcon,
  CheckboxLabel,
  CheckboxGroup,
};
