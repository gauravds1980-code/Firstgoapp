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
import OfferRevealScreen from '../screens/OfferRevealScreen';
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
import MoneyInFlightScreen from '../screens/MoneyInFlightScreen';
import AlertsScreen from '../screens/AlertsScreen';
import AlertSettingsScreen from '../screens/AlertSettingsScreen';
import { inboxEvents, seedAlertsFor } from '../services/alerts';
import { getInboxState, invoicesNow } from '../state/stores';
import { setAlertsVoiceSource } from '../voice/alertsVoice';
import { setPayoutVoiceSource } from '../voice/payoutVoice';
import { statementInvoicesFor } from '../services/payoutStatement';
import { mifFilesFor, isMoneyInFlightEnabled } from '../services/moneyInFlight';
import { setMifVoiceContext } from '../voice/moneyVoice';
import { setStatusVoiceSource } from '../voice/statusVoice';
import { statusFilesFor } from '../services/loanStatus';
import HelpScreen from '../screens/HelpScreen';
import HelpSupportScreen from '../screens/HelpSupportScreen';
import PrivacyTermsScreen from '../screens/PrivacyTermsScreen';
import ComingSoonScreen from '../screens/ComingSoonScreen';
import { navRef } from './navRef';
import { ZippyBubble } from '../components/assistant/ZippyBubble';
import { VoiceHost } from '../voice/VoiceHost';
import ShortsFeed from '../components/tutorial/ShortsFeed';
import { loadTutorialManifest } from '../tutorial/manifest';
import { configureVideoCache } from '../tutorial/useTutorialVideo';
import { reportActivity } from '../tutorial/tutorialStore';
import { useTutorialNudges } from '../tutorial/useTutorialNudges';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Scanner slides up from the bottom. On iOS a native `fullScreenModal` is presented above the RN
 * root, which would hide the global Zippy overlay (Android renders modals as regular stack
 * screens). So on iOS it's a card that slides up and dismisses with a swipe down — same look as Android.
 */
const SCAN_OPTIONS = Platform.OS === 'ios'
  ? { animation: 'slide_from_bottom', presentation: 'card', gestureDirection: 'vertical' } as const
  : { animation: 'slide_from_bottom', presentation: 'fullScreenModal' } as const;
export { navRef };

/** Deep links (also give each screen a URL on web, used for screenshots). */
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['boom://'],
  config: {
    screens: {
      DealerLogin: 'login',
      DealerOtp: 'login/otp',
      Home: '',
      Profile: 'profile',
      HelpSupport: 'support',
      PrivacyTerms: 'privacy',
      ComingSoon: 'soon/:kind',
      QuickList: 'list/:kind',
      ScanQr: 'scan',
      SearchMobile: 'search/:stage?',
      Offer: 'offer',
      OfferReveal: 'offer-reveal',
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
      MoneyInFlight: 'money',
      Alerts: 'alerts',
      AlertSettings: 'alerts/settings',
      Help: 'help',
      ShortsFeed: 'shorts/:startId?',
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
  // v1.3.0: Zippy's "drop a short" detector follows every route change (and spots back navigations).
  const onNavState = useTutorialNudges();
  // Streaming tutorials: video disk cache (before any player exists) and the remote manifest.
  React.useEffect(() => { configureVideoCache(); void loadTutorialManifest(); }, []);
  // v1.4.6 Money in flight: voice answers read the signed-in dealer's gate + files (same mock source as the list).
  React.useEffect(() => {
    setMifVoiceContext({ enabled: isMoneyInFlightEnabled(session?.profile), files: session ? mifFilesFor(session.mobile, session.profile) : [], openLan: null });
  }, [session]);
  // v1.4.7 alerts: voice reads the signed-in dealer's shared inbox (seeds + read marks) at answer time.
  React.useEffect(() => {
    const seeds = session ? seedAlertsFor(session.mobile, session.profile) : [];
    const dealerId = session?.dealerId;
    setAlertsVoiceSource(() => {
      const inbox = getInboxState(dealerId);
      return { signedIn: !!session, events: inboxEvents(seeds, inbox), inbox };
    });
  }, [session]);
  // v1.4.8 payout statement: voice reads the signed-in dealer's statement (seed + their claims) at answer time.
  React.useEffect(() => {
    const seed = session ? statementInvoicesFor(session.mobile, session.profile) : [];
    const dealerId = session?.dealerId;
    setPayoutVoiceSource(() => ({ signedIn: !!session, invoices: invoicesNow(dealerId, seed) }));
  }, [session]);
  // v1.4.9 status checks: voice answers read the signed-in dealer's files (Money in flight + applications) and statement.
  React.useEffect(() => {
    const files = session ? statusFilesFor(session.mobile, session.profile) : [];
    const seed = session ? statementInvoicesFor(session.mobile, session.profile) : [];
    const dealerId = session?.dealerId;
    const mifEnabled = isMoneyInFlightEnabled(session?.profile);
    setStatusVoiceSource(() => ({ signedIn: !!session, mifEnabled, files, invoices: invoicesNow(dealerId, seed) }));
  }, [session]);
  const sync = () => { setRoute(navRef.getCurrentRoute()?.name); onNavState(navRef.getRootState()); };
  if (!sessionRestored) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator color={colors.primary} /></View>;
  }
  return (
    // Any touch anywhere restarts the nudge idle clock (capture phase, never claims the responder).
    <View style={{ flex: 1 }} onTouchStart={reportActivity} onStartShouldSetResponderCapture={() => { reportActivity(); return false; }}>
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
            <Stack.Screen name="HelpSupport" component={HelpSupportScreen} />
            <Stack.Screen name="PrivacyTerms" component={PrivacyTermsScreen} />
            <Stack.Screen name="ComingSoon" component={ComingSoonScreen} />
            <Stack.Screen name="QuickList" component={QuickListScreen} />
            <Stack.Screen name="ScanQr" component={ScanQrScreen} options={SCAN_OPTIONS} />
            <Stack.Screen name="SearchMobile" component={SearchMobileScreen} />
            <Stack.Screen name="Offer" component={OfferScreen} />
            <Stack.Screen name="OfferReveal" component={OfferRevealScreen} options={{ animation: 'fade', gestureEnabled: false }} />
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
            <Stack.Screen name="MoneyInFlight" component={MoneyInFlightScreen} />
            <Stack.Screen name="Alerts" component={AlertsScreen} />
            <Stack.Screen name="AlertSettings" component={AlertSettingsScreen} />
            <Stack.Screen name="Help" component={HelpScreen} />
          </Stack.Group>
        )}
        {/* Reels-style shorts feed: available signed in or out (Zippy can offer the sign-in short). */}
        <Stack.Group key="shared">
          <Stack.Screen name="ShortsFeed" component={ShortsFeed}
            options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false, contentStyle: { backgroundColor: '#000' } }} />
        </Stack.Group>
      </Stack.Navigator>
      <ZippyBubble route={route} />
      {/* One voice session for the whole app, with its bottom-right mic (VoiceMic) and live transcript; independent of Zippy. */}
      <VoiceHost route={route} />
    </NavigationContainer>
    </View>
  );
}
