import React from 'react';
import { ActivityIndicator, Platform, View } from 'react-native';
import { useApp } from '../state/AppState';
import DealerLoginScreen from '../screens/DealerLoginScreen';
import DealerOtpScreen from '../screens/DealerOtpScreen';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LinkingOptions, NavigationContainer } from '@react-navigation/native';
import type { RootStackParamList } from './types';
import { colors } from '../theme/tokens';
import HomeScreen from '../screens/HomeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import QuickListScreen from '../screens/QuickListScreen';
import ScanQrScreen from '../screens/ScanQrScreen';
import SearchMobileScreen from '../screens/SearchMobileScreen';
import OfferScreen from '../screens/OfferScreen';
import AssetScreen from '../screens/AssetScreen';
import FaceKycScreen from '../screens/FaceKycScreen';
import MandateScreen from '../screens/MandateScreen';
import EsignScreen from '../screens/EsignScreen';
import DocsScreen from '../screens/DocsScreen';
import DisbursalScreen from '../screens/DisbursalScreen';
import PayoutsScreen from '../screens/PayoutsScreen';
import PortfolioScreen from '../screens/PortfolioScreen';
import CasesScreen from '../screens/CasesScreen';
import RcPendencyScreen from '../screens/RcPendencyScreen';
import TaInfScreen from '../screens/TaInfScreen';
import { createNavigationContainerRef } from '@react-navigation/native';
import { ZippyBubble } from '../components/assistant/ZippyBubble';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Scanner slides up from the bottom. On iOS a native `fullScreenModal` is presented above the RN
 * root, which would hide the global Zippy overlay (Android renders modals as regular stack
 * screens). So on iOS it's a card that slides up and dismisses with a swipe down — same look as Android.
 */
const SCAN_OPTIONS = Platform.OS === 'ios'
  ? { animation: 'slide_from_bottom', presentation: 'card', gestureDirection: 'vertical' } as const
  : { animation: 'slide_from_bottom', presentation: 'fullScreenModal' } as const;
export const navRef = createNavigationContainerRef<RootStackParamList>();

/** Deep links (also give each screen a URL on web, used for screenshots). */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['boom://'],
  config: {
    screens: {
      DealerLogin: 'login',
      DealerOtp: 'login/otp',
      Home: '',
      Profile: 'profile',
      QuickList: 'list/:kind',
      ScanQr: 'scan',
      SearchMobile: 'search/:stage?',
      Offer: 'offer',
      Asset: 'asset',
      FaceKyc: 'kyc',
      Mandate: 'mandate',
      Esign: 'esign',
      Docs: 'docs',
      Disbursal: 'disbursal',
      Payouts: 'payouts',
      Portfolio: 'portfolio',
      Cases: 'cases',
      RcPendency: 'rc',
      TaInf: 'ta-inf',
    },
  },
};

/**
 * Auth gate. One native stack whose screen set depends on the dealer session:
 *  - no session  -> Auth stack: DealerLogin -> DealerOtp
 *  - session     -> Main stack starting at Home
 * Because the screen sets are swapped (React Navigation's auth-flow pattern), signing in
 * unmounts the auth screens — Back can't return to OTP — and logging out unmounts the main
 * stack and lands on DealerLogin. No tab bar.
 */
export default function RootNavigator() {
  const { session, sessionRestored } = useApp();
  const [route, setRoute] = React.useState<string | undefined>();
  const sync = () => setRoute(navRef.getCurrentRoute()?.name);
  if (!sessionRestored) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator color={colors.primary} /></View>;
  }
  return (
    <NavigationContainer linking={linking} ref={navRef} onReady={sync} onStateChange={sync}>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }}>
        {!session ? (
          <Stack.Group key="auth" screenOptions={{ animationTypeForReplace: 'pop' }}>
            <Stack.Screen name="DealerLogin" component={DealerLoginScreen} />
            <Stack.Screen name="DealerOtp" component={DealerOtpScreen} />
          </Stack.Group>
        ) : (
          <Stack.Group key="main">
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="QuickList" component={QuickListScreen} />
            <Stack.Screen name="ScanQr" component={ScanQrScreen} options={SCAN_OPTIONS} />
            <Stack.Screen name="SearchMobile" component={SearchMobileScreen} />
            <Stack.Screen name="Offer" component={OfferScreen} />
            <Stack.Screen name="Asset" component={AssetScreen} />
            <Stack.Screen name="FaceKyc" component={FaceKycScreen} />
            <Stack.Screen name="Mandate" component={MandateScreen} />
            <Stack.Screen name="Esign" component={EsignScreen} />
            <Stack.Screen name="Docs" component={DocsScreen} />
            <Stack.Screen name="Disbursal" component={DisbursalScreen} options={{ gestureEnabled: false }} />
            <Stack.Screen name="Payouts" component={PayoutsScreen} />
            <Stack.Screen name="Portfolio" component={PortfolioScreen} />
            <Stack.Screen name="Cases" component={CasesScreen} />
            <Stack.Screen name="RcPendency" component={RcPendencyScreen} />
            <Stack.Screen name="TaInf" component={TaInfScreen} />
          </Stack.Group>
        )}
      </Stack.Navigator>
      <ZippyBubble route={route} />
    </NavigationContainer>
  );
}
