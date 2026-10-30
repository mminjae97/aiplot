export const strings = {
  app: {
    name: 'Aiplot',
  },
  window: {
    minimize: '최소화',
    maximize: '최대화',
    restore: '이전 크기로',
    close: '닫기',
  },
  server: {
    starting: 'Aiplot을 준비하고 있어요',
    errorTitle: 'Aiplot을 시작하지 못했어요',
    missing: '앱의 서버 파일을 찾을 수 없어요. 앱을 다시 설치해 주세요.',
    failed: '서버가 여러 번 연달아 멈췄어요. 잠시 뒤 다시 시도해 주세요.',
    retry: '다시 시도',
  },
  stage: {
    1: '기획',
    2: '연출',
    3: '집필',
  },
  library: {
    empty: '첫 작품을 시작해 보세요',
    loadFailed: '작품 목록을 불러오지 못했어요.',
    retry: '다시 시도',
    newBook: '새로 만들기',
    shelfLabel: '책장',
    stageOf: (stage: string) => `${stage} 단계`,
    modified: (date: string) => `${date} 수정`,
  },
  newBook: {
    title: '새 작품',
    label: '제목',
    placeholder: '작품 제목',
    create: '만들기',
    cancel: '취소',
    titleEmpty: '제목을 입력해 주세요.',
    titleTooLong: '제목은 100자까지 쓸 수 있어요.',
    failed: '작품을 만들지 못했어요. 다시 시도해 주세요.',
  },
  contents: {
    back: '← 서재',
    heading: '목차',
    notStarted: '시작 전',
    laterStage: '앞 단계를 마치면 열려요',
    loadFailed: '작품을 불러오지 못했어요.',
    groups: [
      { stage: 1, items: ['세계관', '캐릭터', '지역', '스토리'] },
      { stage: 2, items: ['연출 구성'] },
      { stage: 3, items: ['집필', '소설 읽기'] },
    ],
  },
} as const
