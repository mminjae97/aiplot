/** The fixed scene devices (§9): each one's Korean name and yes/no question, in the list's
 * order. From training/eval/step2/devices/vocab.json. */
export const DEVICES = {
  knowledge_gap: {
    name: '독자만 아는 사실',
    question: '어떤 인물은 모르는 위험·정체·계획을 독자나 다른 인물은 이미 알고 있는가?',
  },
  hidden_secret: {
    name: '숨긴 정체·비밀',
    question: '인물이 자기 정체나 비밀, 숨긴 행적을 다른 인물에게 감추고 있는가?',
  },
  mystery: {
    name: '가려진 원인',
    question: '결과는 보이지만 무슨 일이 왜 일어났는지는 가려진 수수께끼가 이 장면에 있는가?',
  },
  reveal: {
    name: '진실 폭로·반전',
    question: '숨겨졌던 진실이나 정체가 드러나 그때까지의 이해가 뒤집히는가?',
  },
  reversal: {
    name: '형세 역전',
    question: '인물의 처지나 우위가 뒤집히거나, 행동이 의도와 정반대의 결과를 낳는가?',
  },
  plant: {
    name: '단서·징조 심기',
    question: '뒤에 쓰일 물건·말·단서나 앞으로 올 일의 불길한 징조가 슬쩍 놓이는가?',
  },
  payoff: {
    name: '복선 회수',
    question: '앞에서 깔아 둔 단서·물건·약속이 이 장면에서 쓰이거나 그 의미가 밝혀지는가?',
  },
  foretold: {
    name: '결과 예고',
    question:
      '앞으로 일어날 결과를 예언·예고·미래 장면으로 미리 알려 주어, 결과를 알고 과정을 지켜보게 하는가?',
  },
  deadline: {
    name: '시한 압박',
    question: '정해진 시한이나 줄어드는 남은 시간이 인물을 압박하는가?',
  },
  dilemma: {
    name: '결단의 갈림길',
    question: '인물이 대가가 따르는 선택지 사이에서 고민하거나 돌이킬 수 없는 결정을 내리는가?',
  },
  eerie_threat: {
    name: '보이지 않는 위협',
    question: '정체를 알 수 없는 위협이나 기이한 일이 소리·흔적·이상 징후로만 드러나는가?',
  },
  action: {
    name: '정면 대결',
    question: '싸움·추격·습격처럼 승패가 걸린 몸의 대결이 이 장면의 중심인가?',
  },
  held_moment: {
    name: '순간 늘이기',
    question: '결정적인 몇 초나 견디기 힘든 기다림을 멈추듯 길게 늘여 보여 주는가?',
  },
  past_told: {
    name: '과거 회상·증언',
    question:
      '인물이 과거를 떠올리거나 남에게 지난 일을 들려주거나, 이야기가 과거 장면으로 돌아가는가?',
  },
  embedded: {
    name: '매체·이야기 속 이야기',
    question:
      '편지·메시지·일기·기록·그림·꿈·작중 이야기처럼 매체나 이야기 속 이야기를 거쳐 내용이 전해지는가?',
  },
  time_skip: {
    name: '시간 건너뛰기',
    question: '며칠·몇 달·몇 년의 시간이 건너뛰어지거나 몇 문장으로 압축되는가?',
  },
  revisit: {
    name: '다시 돌아옴',
    question: '앞에 나왔던 장소·장면·말·모티프가 다시 돌아와 처음과 대비되는가?',
  },
  repetition: {
    name: '반복과 변주',
    question: '비슷한 시도나 상황이 여러 번 되풀이되며 매번 조금씩 달라지는가?',
  },
  unspoken: {
    name: '말 못 한 속뜻',
    question:
      '인물이 진짜 감정이나 하고 싶은 말을 직접 하지 못하고 돌려 말하거나 침묵하거나 말을 끊는가?',
  },
  verbal_clash: {
    name: '말로 맞섬',
    question: '인물들이 말다툼·협상·심문처럼 말로 주도권을 다투는가?',
  },
  misunderstanding: {
    name: '오해·엇갈림',
    question: '인물이 상대의 말·의도·정체나 상황의 의미를 잘못 알고 행동하는가?',
  },
  overhear: {
    name: '엿듣기·엿보기',
    question: '인물이 숨어서나 우연히 남의 대화·비밀·사건을 엿듣거나 엿보는가?',
  },
  crowd_voice: {
    name: '소문·구경꾼',
    question: '여러 사람(마을·동료·대중·구경꾼)의 소문·여론·반응이 장면에 드러나는가?',
  },
  first_appearance: {
    name: '첫 등장·첫 드러남',
    question: '중요한 인물이나 존재가 처음 등장하거나, 숨겨 온 실력이 처음 드러나는가?',
  },
  realization: {
    name: '깨달음',
    question: '사소한 계기로 인물이 자기 처지나 삶의 의미를 문득 깨닫는가?',
  },
  confession: { name: '고백', question: '인물이 사랑·죄·비밀을 털어놓으려 하거나 털어놓는가?' },
  delayed_outcome: {
    name: '미뤄지는 결과',
    question: '인물과 독자가 기다리는 결과(고백·만남·답)가 방해나 망설임으로 거듭 미뤄지는가?',
  },
  relationship_shift: {
    name: '관계 변화',
    question: '두 인물 사이의 거리·위계·신뢰·편이 이 장면에서 눈에 띄게 바뀌는가?',
  },
  humor: {
    name: '웃음',
    question: '어긋남·과장·장난·착각으로 웃음을 노리는 상황이 이 장면의 중심인가?',
  },
  satire: { name: '권위 조롱', question: '권력자·제도·위선이 조롱받거나 우스꽝스럽게 드러나는가?' },
  new_place: {
    name: '낯선 장소·광경',
    question: '인물이 낯선 장소에 처음 들어서거나 압도적인 광경·존재를 마주하는가?',
  },
  world_rules: {
    name: '세계 규칙 소개',
    question: '독자가 알아야 할 이 세계의 규칙·제도·능력 체계가 이 장면에서 소개되는가?',
  },
  simultaneous: {
    name: '같은 때 다른 곳',
    question: '같은 시간 다른 곳에서 벌어지는 다른 인물의 사건이 함께 다뤄지는가?',
  },
  ordinary_life: {
    name: '일상과 균열',
    question: '인물의 평소 일상이 그려지거나, 그 일상이 이상한 일·사건으로 깨지는가?',
  },
  aftermath: {
    name: '사건 뒤 수습',
    question: '큰 사건이나 절정이 지난 뒤 그 결과를 정리하거나 감정을 추스르는가?',
  },
  contrast: {
    name: '정반대의 병치',
    question: '정반대의 인물·처지·분위기가 나란히 놓이거나 한쪽에서 다른 쪽으로 갑자기 바뀌는가?',
  },
  loss: { name: '상실', question: '죽음·이별·잃어버린 사람이나 시절에 대한 슬픔이 장면에 있는가?' },
  meaningful_object: {
    name: '의미 실린 물건',
    question: '감정이나 관계가 실린 특정 물건·이미지가 장면의 초점이 되는가?',
  },
  differing_views: {
    name: '엇갈린 시선',
    question: '같은 사건이나 관계를 여러 인물이 각자의 입장에서 다르게 보거나 증언하는가?',
  },
  threshold: {
    name: '떠남·경계 넘기',
    question:
      '인물이 익숙한 세계를 떠나거나 금지된 경계를 넘어 되돌아갈 수 없는 국면에 들어서는가?',
  },
  release: {
    name: '터지는 해소',
    question: '오래 쌓여 온 갈등·억울함·감정이 이 장면에서 한꺼번에 터지거나 풀리는가?',
  },
} as const
