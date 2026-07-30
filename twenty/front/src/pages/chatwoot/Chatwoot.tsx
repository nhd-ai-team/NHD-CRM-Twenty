import styled from '@emotion/styled';
import { useMemo } from 'react';
import { useRecoilValue } from 'recoil';

import { tokenPairState } from '@/auth/states/tokenPairState';

const StyledContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
`;

const StyledIframe = styled.iframe`
  border: none;
  flex: 1;
  width: 100%;
  height: 100%;
`;

export const Chatwoot = () => {
  const tokenPair = useRecoilValue(tokenPairState);
  const iframeSrc = useMemo(() => {
    const accessToken = tokenPair?.accessToken?.token;

    if (!accessToken) {
      return 'http://localhost:3004';
    }

    return `http://localhost:3004#twentyAccessToken=${encodeURIComponent(
      accessToken,
    )}`;
  }, [tokenPair?.accessToken?.token]);

  return (
    <StyledContainer>
      <StyledIframe
        src={iframeSrc}
        title="Chatwoot 客服"
        allow="microphone; camera"
      />
    </StyledContainer>
  );
};
