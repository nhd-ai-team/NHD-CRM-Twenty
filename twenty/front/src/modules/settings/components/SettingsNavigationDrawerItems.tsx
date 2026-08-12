import { useMatch, useResolvedPath } from 'react-router-dom';

import {
  IconAt,
  IconCalendarEvent,
  IconColorSwatch,
  IconDatabase,
  IconKey,
  IconLink,
  IconMail,
  IconSettings,
  IconUserCircle,
  IconUsers,
} from '@/ui/display/icon';
import { NavigationDrawerItem } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItem';
import { NavigationDrawerItemGroup } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerItemGroup';
import { NavigationDrawerSection } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSection';
import { NavigationDrawerSectionTitle } from '@/ui/navigation/navigation-drawer/components/NavigationDrawerSectionTitle';

export const SettingsNavigationDrawerItems = () => {
  const isAccountsItemActive = !!useMatch({
    path: useResolvedPath('/settings/accounts').pathname,
    end: true,
  });
  const isAccountsEmailsItemActive = !!useMatch({
    path: useResolvedPath('/settings/accounts/emails').pathname,
    end: true,
  });
  const isAccountsChannelsItemActive = !!useMatch({
    path: useResolvedPath('/settings/accounts/channels').pathname,
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
        <NavigationDrawerItemGroup>
          <NavigationDrawerItem
          label="账户"
            to="/settings/accounts"
            Icon={IconAt}
            active={isAccountsItemActive}
          />
          <NavigationDrawerItem
            level={2}
          label="电子邮件"
            to="/settings/accounts/emails"
            Icon={IconMail}
            active={isAccountsEmailsItemActive}
          />
          <NavigationDrawerItem
            level={2}
            label="渠道"
            to="/settings/accounts/channels"
            Icon={IconLink}
            active={isAccountsChannelsItemActive}
          />
          <NavigationDrawerItem
            level={2}
            label="日历"
            Icon={IconCalendarEvent}
          />
        </NavigationDrawerItemGroup>
      </NavigationDrawerSection>
      <NavigationDrawerSection>
        <NavigationDrawerSectionTitle label="Workspace" />
        <NavigationDrawerItem
          label="General"
          to="/settings/workspace"
          Icon={IconSettings}
          active={
            !!useMatch({
              path: useResolvedPath('/settings/workspace').pathname,
              end: true,
            })
          }
        />
        <NavigationDrawerItem
          label="Data model"
          to="/settings/objects"
          Icon={IconDatabase}
          active={
            !!useMatch({
              path: useResolvedPath('/settings/objects/*').pathname,
              end: false,
            })
          }
        />
        <NavigationDrawerItem
          label="Members"
          to="/settings/workspace-members"
          Icon={IconUsers}
          active={
            !!useMatch({
              path: useResolvedPath('/settings/workspace-members').pathname,
              end: true,
            })
          }
        />
        <NavigationDrawerItem
          label="API and Webhooks"
          to="/settings/api-keys"
          Icon={IconKey}
          active={
            !!useMatch({
              path: useResolvedPath('/settings/api-keys/*').pathname,
              end: false,
            })
          }
        />
      </NavigationDrawerSection>
    </>
  );
};
