import type { DetailedHTMLProps, HTMLAttributes } from 'react';

// App Bridge (cdn.shopify.com/shopifycloud/app-bridge.js) web components.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ui-nav-menu': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
