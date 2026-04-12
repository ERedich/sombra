import React from 'react';
import type { ViewProps } from 'react-native';

import type { VariantProps } from '@gluestack-ui/utils/nativewind-utils';
import { RNView } from '@/lib/rnJsx';
import { boxStyle } from './styles';

type IBoxProps = ViewProps &
  VariantProps<typeof boxStyle> & { className?: string };

const Box = React.forwardRef<React.ComponentRef<typeof RNView>, IBoxProps>(
  function Box({ className, ...props }, ref) {
    return (
      <RNView ref={ref} {...props} className={boxStyle({ class: className })} />
    );
  }
);

Box.displayName = 'Box';
export { Box };
