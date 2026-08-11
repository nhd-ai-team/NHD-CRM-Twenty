import { useMatch, useResolvedPath } from 'react-router-dom';

import {
  IconAt,
  IconCalendarEvent,
  IconColorSwatch,
  IconMail,
  IconUserCircle,
} from '@/ui/display/icon';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerItemGroup } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItemGroup';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';
import { NavigationDrawerSectionTitle } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSectionTitle';
import { useIsFeatureEnabled } from '@/workspace/hooks/useIsFeatureEnabled';

export const SettingsNavigationDrawerItems = () => {
  const isMessagingEnabled = useIsFeatureEnabled('IS_MESSAGING_ENABLED');
  const isAccountsItemActive = !!useMatch({
    path: useResolvedPath('/settings/accounts').pathname,
    end: true,
  });
  const isAccountsEmailsItemActive = !!useMatch({
    path: useResolvedPath('/settings/accounts/emails').pathname,
    end: true,
  });

  return (
    <>
      <NavigationDrawerSection>
        <NavigationDrawerSectionTitle label="User" />
        <NavigationDrawerItem
          label="Profile"
          to="/settings/profile"
          Icon={IconUserCircle}
          active={
            !!useMatch({
              path: useResolvedPath('/settings/profile').pathname,
              end: true,
            })
          }
        />
        <NavigationDrawerItem
          label="Appearance"
          to="/settings/profile/appearance"
          Icon={IconColorSwatch}
          active={
            !!useMatch({
              path: useResolvedPath('/settings/profile/appearance').pathname,
              end: true,
            })
          }
        />
        {isMessagingEnabled && (
          <NavigationDrawerItemGroup>
            <NavigationDrawerItem
              label="Accounts"
              to="/settings/accounts"
              Icon={IconAt}
              active={isAccountsItemActive}
            />
            <NavigationDrawerItem
              level={2}
              label="Emails"
              to="/settings/accounts/emails"
              Icon={IconMail}
              active={isAccountsEmailsItemActive}
            />
            <NavigationDrawerItem
              level={2}
              label="Calendars"
              Icon={IconCalendarEvent}
              soon
            />
          </NavigationDrawerItemGroup>
        )}
      </NavigationDrawerSection>
    </>
  );
};
