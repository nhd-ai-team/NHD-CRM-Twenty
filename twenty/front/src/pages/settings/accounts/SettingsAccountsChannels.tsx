import { useEffect, useMemo, useState } from 'react';
import styled from '@emotion/styled';
import { useRecoilValue } from 'recoil';

import { tokenPairState } from '@/auth/states/tokenPairState';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { IconSettings } from '@/ui/display/icon';
import { SubMenuTopBarContainer } from '@/ui/layout/page/SubMenuTopBarContainer';
import { Breadcrumb } from '@/ui/navigation/bread-crumb/components/Breadcrumb';

type WhatsAppStatus = {
  status?: string;
  phone?: string;
  displayName?: string;
  accountId?: string;
  qrAvailable?: boolean;
  binding?: {
    bound?: boolean;
    boundToCurrentUser?: boolean;
    boundByOther?: boolean;
    ownerName?: string;
  };
};

const CONV_API_PREFIX = '/conv-api';

const Card = styled.div`
  border: 1px solid ${({ theme }) => theme.border.color.light};
  border-radius: ${({ theme }) => theme.border.radius.md};
  display: flex;
  flex-direction: column;
  width: 700px;
`;

const CardHeader = styled.div`
  align-items: center;
  border-bottom: 1px solid ${({ theme }) => theme.border.color.light};
  display: flex;
  justify-content: space-between;
  padding: ${({ theme }) => theme.spacing(5)};
`;

const HeaderLeft = styled.div`
  align-items: center;
  display: flex;
  gap: ${({ theme }) => theme.spacing(4)};
`;

const Avatar = styled.div`
  align-items: center;
  background: #dcfce7;
  border-radius: 999px;
  color: #16a34a;
  display: flex;
  font-weight: 700;
  height: 48px;
  justify-content: center;
  width: 48px;
`;

const Title = styled.div`
  color: ${({ theme }) => theme.font.color.primary};
  font-size: ${({ theme }) => theme.font.size.lg};
  font-weight: ${({ theme }) => theme.font.weight.semiBold};
`;

const Muted = styled.div`
  color: ${({ theme }) => theme.font.color.light};
  font-size: ${({ theme }) => theme.font.size.sm};
`;

const Badge = styled.div`
  background: ${({ theme }) => theme.background.transparent.light};
  border-radius: 999px;
  color: ${({ theme }) => theme.font.color.secondary};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semiBold};
  padding: ${({ theme }) => theme.spacing(2)} ${({ theme }) => theme.spacing(3)};
`;

const Body = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing(5)};
  padding: ${({ theme }) => theme.spacing(5)};
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 150px 1fr;
  gap: ${({ theme }) => theme.spacing(4)};
`;

const Label = styled.div`
  color: ${({ theme }) => theme.font.color.secondary};
`;

const PairingBox = styled.div`
  border: 1px solid ${({ theme }) => theme.border.color.light};
  border-radius: ${({ theme }) => theme.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing(3)};
  padding: ${({ theme }) => theme.spacing(4)};
`;

const InputRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.spacing(3)};
`;

const Input = styled.input`
  border: 1px solid ${({ theme }) => theme.border.color.medium};
  border-radius: ${({ theme }) => theme.border.radius.sm};
  flex: 1;
  height: 36px;
  padding: 0 ${({ theme }) => theme.spacing(3)};
`;

const ButtonRow = styled.div`
  border-top: 1px solid ${({ theme }) => theme.border.color.light};
  display: flex;
  gap: ${({ theme }) => theme.spacing(3)};
  padding: ${({ theme }) => theme.spacing(4)} ${({ theme }) => theme.spacing(5)};
`;

const Button = styled.button<{ variant?: 'primary' | 'danger' }>`
  background: ${({ variant }) =>
    variant === 'primary' ? '#16a34a' : variant === 'danger' ? '#fff' : '#fff'};
  border: 1px solid
    ${({ variant, theme }) =>
      variant === 'primary'
        ? '#16a34a'
        : variant === 'danger'
          ? '#ef4444'
          : theme.border.color.medium};
  border-radius: ${({ theme }) => theme.border.radius.sm};
  color: ${({ variant, theme }) =>
    variant === 'primary'
      ? '#fff'
      : variant === 'danger'
        ? '#ef4444'
        : theme.font.color.primary};
  cursor: pointer;
  height: 36px;
  padding: 0 ${({ theme }) => theme.spacing(4)};

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

const ErrorText = styled.div`
  color: #dc2626;
  line-height: 1.5;
`;

const CodeBox = styled.div`
  background: #f0fdf4;
  border: 1px solid #86efac;
  border-radius: ${({ theme }) => theme.border.radius.sm};
  color: #166534;
  padding: ${({ theme }) => theme.spacing(3)};
`;

const QrImage = styled.img`
  border: 1px solid ${({ theme }) => theme.border.color.light};
  border-radius: ${({ theme }) => theme.border.radius.sm};
  height: 220px;
  object-fit: contain;
  width: 220px;
`;

export const SettingsAccountsChannels = () => {
  const tokenPair = useRecoilValue(tokenPairState);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const accessToken = tokenPair?.accessToken?.token;

  const authHeaders = accessToken
    ? {
        Authorization: `Bearer ${accessToken}`,
        'X-Twenty-Access-Token': accessToken,
      }
    : {};

  const statusLabel = useMemo(() => {
    if (!status?.status) return '未连接';
    if (status.status === 'WORKING') return '已连接';
    if (status.status === 'SCAN_QR_CODE') return '等待扫码';
    if (status.status === 'STARTING') return '启动中';
    if (status.status === 'FAILED') return '连接失败';
    return status.status;
  }, [status?.status]);

  const requestJson = async (url: string, options?: RequestInit) => {
    if (!accessToken) {
      throw new Error('登录状态正在初始化，请稍后重试。');
    }
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...(options?.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || data.detail || '请求失败');
    }
    return data;
  };

  const refreshStatus = async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await requestJson(`${CONV_API_PREFIX}/channel-accounts/whatsapp/status`);
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WhatsApp 状态读取失败');
    } finally {
      setIsLoading(false);
    }
  };

  const refreshQr = async () => {
    setIsLoading(true);
    setError('');
    setMessage('');
    try {
      await requestJson(`${CONV_API_PREFIX}/channel-accounts/whatsapp/restart`, {
        method: 'POST',
      });
      const response = await fetch(`${CONV_API_PREFIX}/channel-accounts/whatsapp/qr?t=${Date.now()}`, {
        headers: authHeaders,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || data.detail || '二维码刷新失败');
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      setQrUrl((current) => {
        if (current.startsWith('blob:')) URL.revokeObjectURL(current);
        return objectUrl;
      });
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '二维码刷新失败');
    } finally {
      setIsLoading(false);
    }
  };

  const requestPairingCode = async () => {
    setIsLoading(true);
    setError('');
    setMessage('');
    setPairingCode('');
    try {
      const data = await requestJson(
        `${CONV_API_PREFIX}/channel-accounts/whatsapp/request-code`,
        {
          method: 'POST',
          body: JSON.stringify({ phoneNumber }),
        },
      );
      setPairingCode(data.code || '');
      setMessage(data.expiresHint || '请在生成后 60 秒内输入配对码。');
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '配对码生成失败');
    } finally {
      setIsLoading(false);
    }
  };

  const bindAccount = async () => {
    setIsLoading(true);
    setError('');
    setMessage('');
    try {
      const data = await requestJson(`${CONV_API_PREFIX}/channel-accounts/whatsapp/bind`, {
        method: 'POST',
      });
      setStatus(data);
      setMessage('已绑定到当前 CRM 账号。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '绑定失败');
    } finally {
      setIsLoading(false);
    }
  };

  const unbindAccount = async () => {
    if (!window.confirm('确认解绑当前 WhatsApp 账号？')) return;
    setIsLoading(true);
    setError('');
    setMessage('');
    try {
      await requestJson(`${CONV_API_PREFIX}/channel-accounts/whatsapp`, { method: 'DELETE' });
      setQrUrl('');
      setPairingCode('');
      setMessage('已解绑。');
      await refreshStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解绑失败');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!accessToken) {
      setError('登录状态正在初始化，请稍后重试。');
      return;
    }
    refreshStatus();
  }, [accessToken]);

  useEffect(() => {
    return () => {
      if (qrUrl.startsWith('blob:')) URL.revokeObjectURL(qrUrl);
    };
  }, [qrUrl]);

  return (
    <SubMenuTopBarContainer Icon={IconSettings} title="Settings">
      <SettingsPageContainer>
        <Breadcrumb
          links={[
            { children: 'Accounts', href: '/settings/accounts' },
            { children: '渠道' },
          ]}
        />
        <Card>
          <CardHeader>
            <HeaderLeft>
              <Avatar>W</Avatar>
              <div>
                <Title>WhatsApp</Title>
                <Muted>绑定当前用户自己的 WhatsApp 渠道账号。</Muted>
              </div>
            </HeaderLeft>
            <Badge>{isLoading ? '加载中' : statusLabel}</Badge>
          </CardHeader>
          <Body>
            <Row>
              <Label>绑定号码</Label>
              <div>{status?.phone || '-'}</div>
            </Row>
            <Row>
              <Label>显示名称</Label>
              <div>{status?.displayName || '-'}</div>
            </Row>
            <Row>
              <Label>WhatsApp ID</Label>
              <div>{status?.accountId || '-'}</div>
            </Row>
            <Row>
              <Label>CRM 绑定</Label>
              <div>
                {status?.binding?.bound
                  ? status.binding.boundToCurrentUser
                    ? '已绑定到当前账号'
                    : `已绑定到 ${status.binding.ownerName || '其他账号'}`
                  : '-'}
              </div>
            </Row>
            {qrUrl && (
              <Row>
                <Label>二维码</Label>
                <div>
                  <QrImage src={qrUrl} alt="WhatsApp QR code" />
                  <Muted>二维码有效时间较短，请打开 WhatsApp 扫描。</Muted>
                </div>
              </Row>
            )}
            <PairingBox>
              <Title>手机号配对</Title>
              <InputRow>
                <Input
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  placeholder="输入带国家区号的号码，如 8613800000000（仅示例）"
                />
                <Button
                  variant="primary"
                  onClick={requestPairingCode}
                  disabled={isLoading}
                >
                  生成配对码
                </Button>
              </InputRow>
              {pairingCode && (
                <CodeBox>
                  配对码：{pairingCode}
                  <br />
                  请在 60 秒内打开 WhatsApp 手机端，进入“关联设备”并输入该配对码。
                </CodeBox>
              )}
            </PairingBox>
            {message && <CodeBox>{message}</CodeBox>}
            {error && <ErrorText>{error}</ErrorText>}
          </Body>
          <ButtonRow>
            <Button onClick={refreshStatus} disabled={isLoading}>
              刷新状态
            </Button>
            <Button onClick={refreshQr} disabled={isLoading}>
              启动/刷新二维码
            </Button>
            <Button
              variant="primary"
              onClick={bindAccount}
              disabled={isLoading}
            >
              绑定到我的账号
            </Button>
            <Button variant="danger" onClick={unbindAccount} disabled={isLoading}>
              解绑
            </Button>
          </ButtonRow>
        </Card>
      </SettingsPageContainer>
    </SubMenuTopBarContainer>
  );
};
