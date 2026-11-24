import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { JourneyScreen } from '../components/Screen';
import { Card, Icon, Pill, Skeleton, Text } from '../components/ui';
import type { RootStackParamList } from '../navigation/types';
import { QUICK_LISTS } from '../services/dealer';
import { useApp } from '../state/AppState';
import { colors, space } from '../theme/tokens';

/** Generic list screen used by Actions tiles, Loans "View all" and Payouts "View all" (mock data). */
export default function QuickListScreen() {
  const { params } = useRoute<RouteProp<RootStackParamList, 'QuickList'>>();
  const { categories } = useApp();
  const src = QUICK_LISTS[params.kind];
  const list = { ...src, rows: src.rows.filter((r) => !r.product || categories.includes(r.product)) };
  const [ready, setReady] = useState(false);
  useEffect(() => { const t = setTimeout(() => setReady(true), 600); return () => clearTimeout(t); }, []);
  const tone = (t?: string) => (t === 'Overdue' ? 'danger' : t === 'Pending' || t === 'Due soon' || t === 'Accruing' ? 'warning' : t === 'Approved' || t === 'New' ? 'info' : 'success') as 'danger' | 'warning' | 'info' | 'success';
  return (
    <JourneyScreen assistant="home" showTerms={false}>
      <View style={{ gap: space.xxs }}>
        <Text variant="h1">{list.title}</Text>
        <Text variant="body" color={colors.textSecondary}>{list.subtitle}</Text>
      </View>
      <Card style={{ padding: 0 }}>
        {(ready ? list.rows : list.rows.map(() => null)).map((r, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.md, minHeight: 72, borderBottomWidth: i === list.rows.length - 1 ? 0 : 1, borderBottomColor: colors.border }}>
            {r ? (
              <>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong">{r.title}</Text>
                  <Text variant="caption" color={colors.textSecondary}>{r.meta}</Text>
                </View>
                {r.tag && <Pill label={r.tag.toUpperCase()} tone={tone(r.tag)} />}
                <Icon name="chevron-right" size={20} color={colors.textSecondary} />
              </>
            ) : (<View style={{ flex: 1, gap: 6 }}><Skeleton w="70%" /><Skeleton w="50%" h={12} /></View>)}
          </View>
        ))}
      </Card>
      <Text variant="caption" color={colors.textMuted}>Prototype: mock data.</Text>
    </JourneyScreen>
  );
}
