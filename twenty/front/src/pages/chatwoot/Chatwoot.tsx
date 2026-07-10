import styled from '@emotion/styled';

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
  return (
    <StyledContainer>
      <StyledIframe
        src="http://localhost:3004"
        title="Chatwoot 客服"
        allow="microphone; camera"
      />
    </StyledContainer>
  );
};
