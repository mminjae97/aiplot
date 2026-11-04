"""Development seed: the sample work (TITLE below), from the user's own academy novel setting.

Creates one work with 93 cards (world 15, character 29, region 13, main_story 1, part 5,
episode 30) in a data dir. Every card goes through services.cards.save, so relation tables and
status are real; no LLM. Two characters (too few speech examples, none) and 19 episodes (no
structure yet, one without a main place) stay incomplete, as in the setting.

Dev only, never shipped: aiplot-server.spec bundles the aiplot package, not scripts/.

Usage (from server/): uv run python scripts/seed_academy.py <data dir>
A data dir whose DB already holds a work with this title is left as it is (exit 0).
"""

# The work's content lines are kept whole, whatever their width.
# ruff: noqa: E501

import sqlite3
import sys
from collections import Counter
from pathlib import Path
from typing import Any

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.services import cards, works

TITLE = "이름 없는 기사의 노래"


def cid(key: str) -> str:
    """Stable card ids from the keys below (c_teo, c_e101, c_wdescent ...)."""
    return "c_" + key.replace("_", "")


# Regions ------------------------------------------------------------------------------------

REGIONS: list[dict[str, Any]] = [
    dict(
        key="chryseon",
        name="수도 크리세온",
        parent=None,
        appearance="황궁과 귀족 저택, 상단 거리와 뒷골목이 겹겹이 들어선 루멘하르트 제국의 수도.",
        natural="제국 한가운데의 너른 평지. 귀족들의 영지가 사방을 둘러싼다.",
        social="황제와 귀족, 상단, 뒷골목 조직이 한 도시에 산다. 엘레오스 교단의 병원과 고아원이 있다.",
        smell="갓 구운 빵 냄새와 마차 길의 먼지",
        sound="마차 바퀴 소리와 시장의 호객",
        mood="화려하지만 그늘이 깊다",
        links=[
            ("linden", 3, "day", "마차", "서"),
            ("heidel", 6, "day", "말", "북서"),
            ("erhardt", 6, "day", "말", "북동"),
            ("wallenstein", 4, "day", "마차", "동"),
            ("eich", 1, "day", "마차", "남"),
        ],
        notes=[
            "크리세온은 루멘하르트 제국의 수도다.",
            "수도에는 황궁과 귀족들의 저택, 상단 거리, 뒷골목이 있다.",
            "엘레오스 교단의 병원과 고아원도 수도에 있다.",
        ],
    ),
    dict(
        key="arcadia",
        name="황립 아르카디아 아카데미",
        parent="chryseon",
        appearance="수도 크리세온 안의 넓은 학원. 동관과 서관 기숙사, 공용 훈련장과 대강의실, 지하 강당과 온실이 있다.",
        natural="성벽 안쪽 언덕에 자리 잡은 학원 부지. 온실 한켠에 허브가 자란다.",
        social="귀족과 상인 자녀, 모험가 지망 평민이 함께 배운다. 기숙사에서는 남녀만 나뉘고 신분은 섞인다.",
        smell="훈련장의 흙냄새와 온실의 허브 향",
        sound="검이 부딪치는 소리와 종소리",
        mood="설레고 밝지만 지하에 그림자가 있다",
        links=[],
        notes=[
            "아르카디아는 수도 크리세온에 있는 황립 아카데미다.",
            "훈련장과 대강의실은 학년 전체가 함께 쓰는 공용 시설이다.",
            "기숙사는 동관과 서관으로 나뉘고, 테오의 반과 에른의 반은 동관이다.",
        ],
    ),
    dict(
        key="kreuz",
        name="크로이츠령",
        parent=None,
        appearance="수도 서쪽, 검은 숲과 길게 맞닿은 크로이츠 후작가의 영지.",
        natural="숲과 맞닿은 긴 변경. 서남쪽으로 갈수록 외지고 가난하다.",
        social="명문 기사 가문 크로이츠 후작가가 다스린다. 율리안이 죽은 뒤 황실로 귀속된다.",
        smell="젖은 나무와 이끼 냄새",
        sound="숲에서 불어오는 바람 소리",
        mood="엄격하고 고요하다",
        links=[],
        notes=[
            "크로이츠령은 수도 서쪽에 있고 검은 숲과 길게 맞닿아 있다.",
            "린덴 마을과 펠트하임이 크로이츠령에 속한다.",
        ],
    ),
    dict(
        key="linden",
        name="린덴 마을",
        parent="kreuz",
        appearance="광장 하나와 빨래터가 있는 외딴 시골 마을.",
        natural="숲 가장자리의 작은 골짜기. 수도에서 마차로 사흘 거리다.",
        social="농사와 품팔이로 사는 평민들의 마을. 가끔 음유시인이 광장에 들른다.",
        smell="빨래 비누와 마른 풀 냄새",
        sound="광장의 노랫소리와 개 짖는 소리",
        mood="소박하고 따뜻하다",
        links=[("feldheim", 5, "day", "도보", "남서")],
        notes=[
            "린덴 마을은 테오와 제나의 고향이다.",
            "외딴 시골이지만 펠트하임보다는 수도에 가깝다.",
        ],
    ),
    dict(
        key="feldheim",
        name="펠트하임",
        parent="kreuz",
        appearance="크로이츠령 서남쪽 깊숙이 있는 외딴 가난한 마을.",
        natural="검은 숲 바로 앞의 척박한 땅.",
        social="마을 사람들이 학비를 모아 얀을 대표로 보냈다. 전쟁 뒤 얀이 영주가 되고 마을 사람들은 가신이 된다.",
        smell="장작 연기와 흙냄새",
        sound="망치질 소리와 아이들 소리",
        mood="가난하지만 끈끈하다",
        links=[("blackforest", 6, "hour", "도보", "서")],
        notes=[
            "펠트하임은 얀과 로제의 고향이다.",
            "전쟁 때 지친 일행의 후퇴 거점이 된다.",
            "전쟁 뒤 크로이츠령에서 분리되어 펠트하임령이 된다.",
        ],
    ),
    dict(
        key="blackforest",
        name="검은 숲",
        parent=None,
        appearance="어디까지 이어지는지 모를 서쪽의 미개척 숲. 끝없는 숲이라고도 부른다.",
        natural="제국 서쪽을 따라 남쪽 끝까지 이어지는 원시림.",
        social="사람이 살지 않는 미개척지. 모험가들이 의뢰를 받고 드나든다.",
        smell="썩은 잎과 짐승 냄새",
        sound="정적 속의 날갯짓",
        mood="위험하고 깊다",
        links=[],
        notes=["검은 숲은 서쪽의 미개척지다.", "율리안의 보더콜리 벨이 이 숲에서 죽었다."],
    ),
    dict(
        key="stahl",
        name="슈탈령",
        parent=None,
        appearance="검은 숲, 하이델령, 크로이츠령 사이에 끼어 있는 작은 변경 영지.",
        natural="숲과 구릉 사이의 좁은 땅.",
        social="슈탈 자작가가 다스린다.",
        smell="쇠와 숯 냄새",
        sound="대장간 소리",
        mood="빠듯하고 날이 서 있다",
        links=[
            ("heidel", 3, "day", "말", "북"),
            ("linden", 3, "day", "말", "남"),
            ("blackforest", 1, "day", "도보", "서"),
        ],
        notes=["슈탈령은 에드먼드의 고향인 슈탈 자작가의 영지다."],
    ),
    dict(
        key="heidel",
        name="하이델령",
        parent=None,
        appearance="맑은 날보다 흐린 날이 많은 북서쪽의 영지. 본가에 에른의 추모의 방이 있다.",
        natural="옛 대공가가 있던 북쪽의 흐린 고지대.",
        social="세간의 영웅 지크프리트의 하이델 백작가가 다스린다.",
        smell="비에 젖은 돌 냄새",
        sound="낮게 부는 북풍",
        mood="엄숙하고 쓸쓸하다",
        links=[],
        notes=["하이델령은 북서쪽 옛 대공가 지역에 있다.", "지크프리트, 에른, 아멜리의 집이다."],
    ),
    dict(
        key="erhardt",
        name="에어하르트령",
        parent=None,
        appearance="북동쪽 옛 대공가 지역의 후작령.",
        natural="흐린 날이 많은 북쪽의 넓은 땅.",
        social="재무대신 콘라트 에어하르트 후작이 다스린다.",
        smell="잉크와 오래된 장부 냄새",
        sound="조용한 저택의 시계 소리",
        mood="온화해 보이지만 속을 알 수 없다",
        links=[],
        notes=["에어하르트령은 북동쪽 옛 대공가 지역에 있다.", "콘라트와 아리아의 집이다."],
    ),
    dict(
        key="wallenstein",
        name="발렌슈타인령",
        parent=None,
        appearance="동쪽 바다와 맞닿은 공작령.",
        natural="수도 동쪽, 그 너머로 남쪽 끝까지 이어지는 바다.",
        social="필리의 발렌슈타인 공작가가 다스린다.",
        smell="짠 바닷바람",
        sound="파도와 갈매기 소리",
        mood="넉넉하고 여유롭다",
        links=[("aurea", 5, "day", "배", "남")],
        notes=["발렌슈타인령은 동쪽에 있고 바다와 맞닿아 있다."],
    ),
    dict(
        key="eich",
        name="아이히령",
        parent=None,
        appearance="수도와 로젠탈령 사이에 작게 끼어 있는 자작령.",
        natural="수도 바로 남쪽의 작은 들판.",
        social="루카스의 아이히 자작가가 다스린다.",
        smell="밀밭 냄새",
        sound="풍차 소리",
        mood="평범하고 평온하다",
        links=[("rosenthal", 2, "day", "마차", "남")],
        notes=["아이히령은 수도와 로젠탈령 사이에 작게 끼어 있다."],
    ),
    dict(
        key="rosenthal",
        name="로젠탈령",
        parent=None,
        appearance="수도의 남쪽, 남부 평야와 이어지는 백작령.",
        natural="끝없이 펼쳐진 남부 평야의 입구.",
        social="카밀라의 로젠탈 백작가가 다스린다.",
        smell="꽃과 찻잎 냄새",
        sound="들판의 벌 소리",
        mood="햇살 좋고 다정하다",
        links=[("aurea", 7, "day", "마차", "남동")],
        notes=["로젠탈령은 수도 남쪽에 있고 남부 평야와 이어진다."],
    ),
    dict(
        key="aurea",
        name="아우레아령",
        parent=None,
        appearance="남부 평야가 끝나고 바다와 만나는 곳의 후작령. 곡창과 무역항이 있다.",
        natural="수도에서 먼 동남쪽, 평야와 바다가 만나는 땅.",
        social="릴리안의 아우레아 후작가가 곡창과 무역항으로 부를 쌓았다.",
        smell="곡식 창고와 항구의 향신료 냄새",
        sound="항구의 종소리",
        mood="부유하고 이국적이다",
        links=[],
        notes=[
            "아우레아령은 수도에서 먼 동남쪽에 있다.",
            "남부 평야의 곡창과 무역항이 부의 원천이다.",
        ],
    ),
]


def region_data(r: dict[str, Any], with_links: bool) -> dict[str, Any]:
    return {
        "parent_id": cid(r["parent"]) if r["parent"] else None,
        "links": [
            {"target_id": cid(t), "travel": {"value": v, "unit": u, "mode": m}, "direction": d}
            for t, v, u, m, d in r["links"]
        ]
        if with_links
        else [],
        "appearance": r["appearance"],
        "environment": {"natural": r["natural"], "social": r["social"]},
        "sensory": {"smell": r["smell"], "sound": r["sound"], "mood": r["mood"]},
    }


# Characters ----------------------------------------------------------------------------------

CHARACTERS: list[dict[str, Any]] = [
    dict(
        key="teo",
        name="테오도르",
        origin="linden",
        theme="평범한 사람도 신념을 지키며 특별해질 수 있다",
        traits=["밝음", "솔직함", "꼼꼼함", "낮은 자존감", "결정적인 순간에 발이 먼저 나감"],
        behaviors=[
            ("결정을 앞두었을 때", "할지 말지는 망설이지 않고, 어떻게 할지는 신중하게 고민한다"),
            ("칭찬을 받을 때", '웃으며 "나 따위"라고 자신을 낮춘다'),
            ("누군가 위험할 때", "겁이 나도 먼저 뛰어든다"),
        ],
        speech="시골 말씨가 묻어나는 밝고 솔직한 반말. 자기 얘기는 웃으며 낮춘다.",
        examples=[
            "나 따위가 뭘 알겠어. 그래도 지금 안 하면 후회할 것 같아.",
            "할지 말지는 벌써 정했어. 어떻게 할지만 같이 생각해 줘.",
            "괜찮아, 이 정도는 금방 꿰매.",
            "도망치면 살겠지. 근데 그럼 평생 후회할 거야.",
        ],
        look="흔한 갈색 머리와 눈, 평균 키의 탄탄한 몸, 그을린 피부와 굳은살 박인 손.",
        look_details="수수하지만 표정이 좋아 호감 가는 얼굴. 낡았지만 꼼꼼히 기워 입은 옷.",
        rel=[
            ("zena", "첫사랑이자 소꿉친구"),
            ("julian", "라이벌이자 절친"),
            ("jan", "룸메이트"),
            ("bruno", "스승"),
            ("lillian", "끝까지 밀어내는 상대"),
        ],
        notes=[
            "테오도르는 린덴 마을 출신의 평민이다.",
            "신념은 후회할 만한 일은 하지 않는 것이다.",
            "아버지 요한은 테오가 젖을 떼기 전에 죽었고, 어머니 안나가 홀로 키웠다.",
            "6살 생일에 제나에게 받은 기사 인형을 망가뜨린 일이 깊은 후회로 남았다.",
            "기본 검술과 기본 마법을 극한까지 단련한 기본기의 달인이다.",
        ],
    ),
    dict(
        key="zena",
        name="제노니아 골드윈",
        origin="linden",
        theme="가면 뒤의 진심",
        traits=["밝음", "사교적", "가면과 거짓말에 능숙함", "진심일 땐 긴장해 실수 연발"],
        behaviors=[
            ("감정이 쌓였을 때", "자신을 희생하는 테오에게 화를 낸다"),
            ("긴장할 때", "귀부터 빨개지고 트윈테일 끝을 만지작거린다"),
        ],
        speech="사교적인 존댓말과 밝은 반말을 자유롭게 오가지만, 진심일 땐 말이 꼬인다.",
        examples=[
            "어머, 골드윈 상단을 모르신다니 섭섭한데요?",
            "이건 그냥… 친구 이야기야. 진짜로 친구 이야기라니까!",
            "또 너 혼자 다 짊어지려고 했지? 화낼 거야, 나.",
            "그, 그러니까 내 말은… 아, 몰라!",
        ],
        look="길게 늘어진 금발 웨이브 트윈테일과 에메랄드빛 눈의 화려한 미인.",
        look_details="옷에 맞춘 리본. 어릴 적엔 햇볕에 바랜 금발 단발의 왈가닥이었다.",
        rel=[("teo", "첫사랑"), ("amelie", "절친"), ("hans", "아버지")],
        notes=[
            "제나는 테오의 소꿉친구다.",
            "부친이 준남작 작위를 사서 아카데미에서는 골드윈 영애로 불린다.",
            "테오의 이름은 잊었지만 그 행동 방식을 잊지 못해 10년간 첫사랑을 간직했다.",
        ],
    ),
    dict(
        key="julian",
        name="율리안 크로이츠",
        origin="kreuz",
        theme="후회하지 않는 자의 희생",
        traits=["차가움", "과묵함", "말보다 행동", "개에게 약함"],
        behaviors=[
            ("잘못을 지적받을 때", "후회하지 않기에 사과하지 않는다"),
            ("떠돌이 개를 보면", "무심한 척 먹을 것을 챙겨 준다"),
        ],
        speech="짧고 차가운 말투. 사과도 변명도 하지 않는다.",
        examples=["후회는 안 해.", "비켜. 내가 간다.", "…밥은 먹었냐.", "이번엔 늦지 않는다."],
        look="칠흑 같은 검은 머리, 차가운 회청색 눈, 또래보다 큰 키에 단련된 몸.",
        look_details="날카롭고 반듯한 미남. 벨을 잃은 날의 흉터가 팔에 있고 소매로 가린다.",
        rel=[
            ("teo", "절친이자 자극제"),
            ("ern", "영원한 2등이라 여긴 상대"),
            ("cecilia", "모시는 황태녀"),
        ],
        notes=[
            "율리안은 크로이츠 후작가의 독자다.",
            "입학부터 수석을 한 번도 놓치지 않았다.",
            "10살 무렵 보더콜리 벨이 그를 지키다 죽었다.",
            "신념은 내가 한 일은 후회하지 않는 것이다.",
        ],
    ),
    dict(
        key="ern",
        name="에른스트 하이델",
        origin="heidel",
        theme="영웅이 되고 싶었던 영원한 2등",
        traits=[
            "비꼬는 말투",
            "자신에게 가장 엄격함",
            "교칙을 절대 어기지 않음",
            "도움을 청하지 못함",
        ],
        behaviors=[("율리안을 보면", "시비를 건다"), ("선행을 할 때", "아무에게도 알리지 않는다")],
        speech="말끝마다 가시가 박힌 비꼬는 말투.",
        examples=[
            "수석님께서는 오늘도 여유가 넘치시는군.",
            "시골뜨기가 영웅 흉내라니, 웃기지도 않네.",
            "교칙 위반은 안 해. 너희와 달라서.",
            "이번에는 내가 이겼어. 내가 영웅이야.",
        ],
        look="짙은 적갈색 머리, 날카로운 호박색 눈, 율리안보다 한 뼘 작은 키, 늘 장갑을 낀 손.",
        look_details="흐트러짐 없는 교복.",
        rel=[
            ("siegfried", "동경하는 아버지"),
            ("julian", "넘어서야 할 상대"),
            ("amelie", "여동생"),
            ("aria", "정혼자"),
            ("teo", "거슬리는 녀석"),
        ],
        notes=[
            "에른은 하이델 백작가의 후계자였다.",
            "아버지에게 받은 아다만타이트 검을 남 앞에서 꺼내지 않는다.",
            "1학년 말 첫 비극에서 목숨을 다 써 가며 강림을 막고 죽는다.",
        ],
    ),
    dict(
        key="noel",
        name="노엘",
        origin=None,
        theme="빌린 희망",
        traits=["부드러움", "예의 바름", "특출난 눈썰미", "존재감을 지우는 버릇"],
        behaviors=[
            ("주말이면", "남몰래 교회 고아원에 봉사한다"),
            ("단체와 무관한 사건에서", "죄책감에 일행을 돕는다"),
        ],
        speech="부드럽고 예의 바른 존댓말.",
        examples=[
            "반장으로서 도울 일이 있으면 말해 주세요.",
            "주말이요? 잠깐 들를 곳이 있어서요.",
            "이미 너무 늦어버렸어.",
        ],
        look="탁한 은회색 머리, 평범한 회갈색 눈, 평균 키에 마른 편, 순하고 온화한 인상.",
        look_details="반장 완장. 실눈 웃음은 루시의 미소를 따라 하던 습관이다.",
        rel=[("lucy", "누나 같은 가족"), ("serena", "고마운 사람"), ("teo", "같은 반 친구")],
        notes=[
            "노엘은 테오와 같은 반의 반장이다.",
            "태어날 때부터 영원의 백야에 길러진 고아다.",
            "스스로는 말단이라 여기지만 실은 마왕의 그릇이다.",
        ],
    ),
    dict(
        key="amelie",
        name="아멜리 하이델",
        origin="heidel",
        theme="오빠의 빈자리",
        traits=["의젓함", "단정함", "술에 매우 약함"],
        behaviors=[
            ("힘들 때", "울거나 기대지 않고 버틴다"),
            ("취하면", "제나에게 한껏 응석을 부린다"),
        ],
        speech="단정하고 의젓한 존댓말. 취하면 어리광 섞인 반말이 나온다.",
        examples=[
            "하이델의 이름으로 약속드리죠.",
            "오라버니라면 이렇게 했을 거예요.",
            "제나아… 나 오늘은 좀 기대도 돼?",
        ],
        look="짙은 적갈색 긴 머리를 단정하게 묶고, 차분한 호박색 눈에 곧은 자세.",
        look_details="학생회장 휘장.",
        rel=[("ern", "오빠"), ("zena", "절친"), ("aria", "남몰래 챙기는 친구")],
        notes=[
            "아멜리는 에른의 여동생이다.",
            "오빠가 떠난 뒤 1년 후배로 상업·행정 계열에 입학한다.",
            "오빠가 끝내 얻지 못한 인망으로 학생회장이 된다.",
        ],
    ),
    dict(
        key="phili",
        name="오필리아 발렌슈타인",
        origin="wallenstein",
        theme="그냥 재밌어서",
        traits=["나른한 마이페이스", "생활 능력 제로", "마법 이론 얘기엔 눈을 반짝임"],
        behaviors=[
            ("부탁을 받을 때", "요청받을 때만 돕는다"),
            ("다과회에서", "세레나의 무릎을 베고 연구 자료를 본다"),
        ],
        speech="나른하게 늘어지는 말투. 마법 이론 얘기만 나오면 빨라진다.",
        examples=[
            "음… 귀찮은데. 부탁이면 해 줄게.",
            "잠깐, 방금 그 생각 다시 말해 봐. 그거 되게 재밌는데?",
            "세실리아? 우리 친해.",
        ],
        look="밝은 밀크티빛 갈색 양갈래 머리, 큰 안경, 졸린 눈, 작고 마른 체격.",
        look_details="잉크 얼룩 묻은 큰 로브. 파티 때는 안경을 벗어 하늘색 눈이 드러난다.",
        rel=[
            ("cecilia", "어릴 적부터의 친구"),
            ("reni", "실험 상대"),
            ("teo", "생각의 틀을 깨 주는 사람"),
        ],
        notes=[
            "필리는 발렌슈타인 공작가의 영애다.",
            "마법 이론에 빠진 괴짜다.",
            "파티에 나갈 때면 아무도 못 알아볼 만큼 아름다워진다.",
        ],
    ),
    dict(
        key="jan",
        name="얀 펠트하임",
        origin="feldheim",
        theme="돌아갈 곳을 지키는 창",
        traits=["장난스러움", "분위기 메이커", "돈 문제에 예민함", "유혹에 넘어가지 않음"],
        behaviors=[
            ("마을 얘기가 나오면", "말투는 그대로인데 내용이 진지해진다"),
            ("예쁜 옷을 보면", "로제가 하면 예쁘겠다고 생각한다"),
        ],
        speech="장난스러운 너스레. 마을 얘기엔 같은 말투로 진지한 내용을 말한다.",
        examples=[
            "야야, 그거 얼마짜리야? 우리 마을 한 철 식량값이다.",
            "꼬맹이가 기다리거든. 난 돌아갈 거야.",
            "앞은 내가 막는다. 뒤는 너희가 해.",
        ],
        look="짙은 녹색 머리, 밝은 헤이젤빛 눈, 큰 키와 넓은 어깨, 그을린 피부.",
        look_details="마을 사람들이 모은 쇠로 만든 투박한 창.",
        rel=[("rose", "소꿉친구이자 연인"), ("teo", "룸메이트")],
        notes=[
            "얀은 펠트하임 마을의 대표로 입학한 평민이다.",
            "창을 쓰는 수호자다.",
            "전쟁의 공으로 하위 귀족이 되어 펠트하임령을 받는다.",
        ],
    ),
    dict(
        key="serena",
        name="세레나",
        origin="chryseon",
        theme="성녀 후보이기 이전에 한 소녀",
        traits=["다정함", "고결함", "누나 같음"],
        behaviors=[
            ("다친 사람을 보면", "먼저 다가가 치료한다"),
            ("노엘 앞에서", "소녀다운 모습이 드러난다"),
        ],
        speech="다정한 누나 같은 존댓말.",
        examples=[
            "다친 데부터 보여 주세요. 괜찮아요.",
            "필리, 차 식어요. 자료는 이따 봐요.",
            "노엘 씨는… 오늘도 오셨네요.",
        ],
        look="연보라빛 긴 생머리, 맑은 보랏빛 눈, 온화하고 단아한 인상.",
        look_details="교회 상징의 작은 펜던트.",
        rel=[("noel", "짝사랑"), ("phili", "무릎베개를 해 주는 친구")],
        notes=["세레나는 교회에서 자란 고아이자 성녀 후보다.", "노엘을 남몰래 짝사랑한다."],
    ),
    dict(
        key="cecilia",
        name="세실리아 루멘하르트",
        origin="chryseon",
        theme="모두 구할 수는 없을까",
        traits=["침착함", "기품", "빠른 결단", "공정함", "표정 변화가 거의 없음"],
        behaviors=[
            ("결정을 내릴 때마다", "품에서 노트를 꺼내 무언가 적는다"),
            ("율리안 앞에서", "아주 미세하게 말이 부드러워진다"),
        ],
        speech="감정이 드러나지 않는 짧고 정확한 존댓말.",
        examples=[
            "가장 많은 사람을 살리는 쪽으로 하겠습니다.",
            "이건 내가 사랑했던 사람들의 명단이에요.",
            "반드시 살아 돌아오세요. 명령입니다.",
        ],
        look="황가의 상징인 누구보다 반짝이고 선명한 금발과 금빛 눈.",
        look_details="긴 머리를 단정하게 반묶음. 교복 위 황실 문장의 휘장.",
        rel=[("julian", "숨겨진 짝사랑"), ("phili", "편한 친구"), ("friedrich", "아버지")],
        notes=[
            "세실리아는 루멘하르트 제국의 유일한 계승자인 황태녀다.",
            "자신의 선택으로 희생된 이들을 노트에 적는다.",
        ],
    ),
    dict(
        key="lillian",
        name="릴리안 아우레아",
        origin="aurea",
        theme="처음으로 손에 넣지 못한 것",
        traits=["장난기", "철부지", "상대를 쥐락펴락함", "집착"],
        behaviors=[("갖고 싶은 게 생기면", "수단과 방법을 가리지 않는다")],
        speech="장난기 가득하고 상대를 흔드는 말투.",
        examples=[
            "테오, 오늘도 나 안 볼 거야? 섭섭하다~",
            "갖고 싶은 건 다 가져 봤거든. 너만 빼고.",
            "나는 안 되는데 왜 쟤는 되는 거야?",
        ],
        look="짙은 와인빛의 긴 웨이브 머리와 진홍빛 눈, 또래보다 살짝 작은 키.",
        look_details="한쪽 입꼬리만 먼저 올라가는 미소. 이국적인 장신구와 진주 머리 장식.",
        rel=[("teo", "짝사랑"), ("zena", "연적"), ("dietrich", "손잡은 상대")],
        notes=[
            "릴리안은 아우레아 후작가의 영애다.",
            "입학 시즌에 테오에게 반해 제나보다 먼저 다가간다.",
        ],
    ),
    dict(
        key="shepherd",
        name="목자",
        origin=None,
        theme="평범함을 견디지 못한 지배욕",
        traits=["지배욕", "비겁함"],
        behaviors=[("통제를 잃으면", "모두를 버리고 혼자 도망친다")],
        speech="통제를 잃으면 같은 말을 되뇐다.",
        examples=["이러면 안 되는데."],
        look="아무 무늬 없는 순백의 가면. 가면 아래는 놀랄 만큼 평범한 중년 남자.",
        look_details=None,
        rel=[("noel", "그릇"), ("seraphina", "간부")],
        notes=[
            "목자는 영원의 백야의 수장이다.",
            "이름도 얼굴도 알려지지 않았다.",
            "마왕의 힘을 빼앗으려 한다.",
        ],
    ),
    dict(
        key="erebos",
        name="에레보스",
        origin=None,
        theme="악의 없는 힘",
        traits=["무심함", "압도적인 힘", "굴복하지 않는 자에 대한 흥미"],
        behaviors=[("미물들이 덤비면", "짜증이 나서 응할 뿐이다")],
        speech="하찮은 것을 내려다보는 짧고 무심한 말.",
        examples=["짜증 나는군, 미물들.", "왜 굴복하지 않지?", "…재미있군."],
        look="새하얗게 빛나는 존재. 노엘의 몸에 강림해 전신과 눈동자까지 하얗다.",
        look_details="상처에서 흐르는 붉은 피가 불완전한 강림의 증거다.",
        rel=[("teo", "이해할 수 없는 흥미로운 미물")],
        notes=["에레보스는 마계의 왕이다.", "이름은 독자와 세라피나만 안다."],
    ),
    dict(
        key="konrad",
        name="콘라트 에어하르트",
        origin="erhardt",
        theme="나라를 묶을 외부의 적",
        traits=["온화함", "신망", "신념에 갇힘"],
        behaviors=[("일이 바쁠 때", "정작 딸에게는 신경을 쓰지 못한다")],
        speech="누구에게나 온화한 노신사의 말투.",
        examples=[
            "나라를 묶을 것이 필요하다네.",
            "자네 아버지와는 같은 전장에 섰었지.",
            "이것이… 내가 원했던 결과였나.",
        ],
        look="반백의 잿빛 금발, 다듬은 수염, 회청색 눈, 크고 마른 체격.",
        look_details="꼿꼿한 자세, 손등의 오래된 흉터.",
        rel=[("siegfried", "옛 전우"), ("aria", "딸")],
        notes=["콘라트는 에어하르트 후작이자 재무대신이다.", "영원의 백야의 간부 아울이다."],
    ),
    dict(
        key="seraphina",
        name="세라피나",
        origin=None,
        theme="광신",
        traits=["광기", "요염함", "천재"],
        behaviors=[("누구에게나", "신도처럼 존댓말을 쓴다")],
        speech="누구에게나 신도처럼 쓰는 요염한 존댓말. '당신'은 언제나 마왕을 뜻한다.",
        examples=[
            "당신께서 오시는 밤이에요.",
            "번호 서른일곱, 실패. 아, 기억하고 있어요. 전부.",
            "조금만 더… 당신을 위해서라면.",
        ],
        look="보랏빛 윤기가 도는 칠흑 같은 긴 머리, 짙은 자주색 눈, 창백한 피부의 보랏빛 의식 문양.",
        look_details="보라색 안감의 검은 드레스형 로브, 파이프 담배, 머리 위에 얹은 뱀 가면.",
        rel=[("erebos", "섬기는 당신"), ("noel", "완성한 그릇")],
        notes=["세라피나는 강림 의식의 설계자다.", "단체에서 유일하게 마왕을 진심으로 섬긴다."],
    ),
    dict(
        key="dietrich",
        name="디트리히",
        origin="chryseon",
        theme="계산된 지배",
        traits=["차가움", "계산적", "뛰어난 무력"],
        behaviors=[("배신자에 대해", "끝까지 경계한다")],
        speech="차갑고 계산적인 단문.",
        examples=[
            "가격이 맞으면 팔지.",
            "배신자는 끝까지 기억해 둔다.",
            "돼지는 미끼로나 쓰는 거다.",
        ],
        look="큰 키에 단련된 몸, 뒤로 넘긴 짙은 흑갈색 머리, 차가운 회색 눈.",
        look_details="목덜미에서 쇄골까지 이어진 칼자국, 검은 롱코트와 지팡이처럼 든 장검.",
        rel=[("maximilian", "경멸하는 동료"), ("lillian", "이용하는 협력자")],
        notes=["디트리히는 수도 뒷골목 검은 조직들의 왕이다.", "영원의 백야의 정보·선동 담당이다."],
    ),
    dict(
        key="maximilian",
        name="막시밀리안 그라이프",
        origin=None,
        theme="가장 싸게 쓰인 도구",
        traits=["욕심", "얕은 생각", "윗사람에겐 비굴함", "아랫사람에겐 거만함"],
        behaviors=[("거짓이 들킬 것 같으면", "더 큰 거짓으로 덮는다")],
        speech="윗사람에겐 비굴하고 아랫사람에겐 거만한 말투.",
        examples=[
            "이건 정당한 행정 처리일세.",
            "부학장인 내 말이 곧 규칙이야!",
            "모, 모두에게 인정받을 힘을 주겠다는 걸세.",
        ],
        look="살집 있는 중년 남성, 기름 발라 넘긴 성긴 머리, 손가락마다 반지.",
        look_details="지나치게 화려한 예복.",
        rel=[("ern", "포섭하려 한 학생"), ("noel", "데려간 그릇")],
        notes=["막시밀리안은 아르카디아의 부학장이다.", "백야의 힘으로 학장 자리를 노린다."],
    ),
    dict(
        key="edmund",
        name="에드먼드 슈탈",
        origin="stahl",
        theme="그렇게 얻은 등수",
        traits=["교활함", "욕심", "개과천선"],
        behaviors=[("등수가 걸리면", "남의 성적을 망쳐서라도 올린다")],
        speech="교활한 우등생의 매끄러운 말투. 재등장 후엔 담담해진다.",
        examples=[
            "에른, 저 녀석 성적표 봤어?",
            "그렇게 얻은 등수엔 아무것도 없더군.",
            "공범은 나다. 이제 빠져나갈 길은 없어.",
        ],
        look="짙은 청회색 머리, 옅은 하늘색 눈.",
        look_details="퇴학 전엔 단정하고 날카로운 눈매, 재등장 후엔 짧게 쳐낸 머리와 차분한 눈빛.",
        rel=[("ern", "따라다니던 상대"), ("teo", "빚을 갚을 상대")],
        notes=["에드먼드는 슈탈 자작가의 영식이다.", "3부에서 크로우로서 백야를 배신한다."],
    ),
    dict(
        key="siegfried",
        name="지크프리트 하이델",
        origin="heidel",
        theme="세간의 영웅",
        traits=["다정함", "슬픔이 앞서는 사람"],
        behaviors=[("영지가 위험할 때", "앞장서서 지킨다")],
        speech="다정하고 낮은 목소리.",
        examples=[
            "영웅은 남이 붙여 주는 이름이란다.",
            "곁에서 바로잡아 주지 못했구나, 친구.",
            "내 땅은 내가 지킨다.",
        ],
        look="흰머리가 섞인 짙은 적갈색 머리, 호박색 눈, 수척해진 얼굴.",
        look_details=None,
        rel=[
            ("ern", "아들"),
            ("amelie", "딸"),
            ("konrad", "옛 전우"),
            ("friedrich", "지켜낸 황태자"),
        ],
        notes=["지크프리트는 하이델 백작이자 세간의 영웅이다.", "테오가 동경한 노래 속 기사다."],
    ),
    dict(
        key="hans",
        name="한스 골드윈",
        origin="linden",
        theme="웃는 얼굴의 수완가",
        traits=["허술해 보임", "날카로운 수완", "딸바보"],
        behaviors=[("거래에서", "누구보다 날카롭게 계산한다")],
        speech="허술한 시골 아저씨 말투. 거래에선 날카로워진다.",
        examples=[
            "어이쿠, 요한 녀석 아들 아니냐!",
            "장사는 웃는 얼굴로 하는 거다, 제나야.",
            "그 값이면 손해는 아니지. 난 손해 보는 거래는 안 해.",
        ],
        look="둥글둥글한 체형, 숱이 줄어든 금발, 처진 눈매.",
        look_details=None,
        rel=[("zena", "딸"), ("teo", "절친의 아들")],
        notes=["한스는 골드윈 준남작이자 제나의 아버지다.", "테오 아버지의 절친이다."],
    ),
    dict(
        key="bruno",
        name="브루노",
        origin=None,
        theme="기본기는 배신하지 않는다",
        traits=["엄격함", "근성", "모두에게 공평함"],
        behaviors=[("에른이 몰래 수련할 때", "수련장에 물품을 준비해 둔다")],
        speech="짧고 엄격한 교관 말투.",
        examples=[
            "다시. 기본기는 배신하지 않는다.",
            "재능이 없으면 한 번 더 휘둘러라.",
            "후배들은 내가 맡는다. 가라.",
        ],
        look="짧게 친 짙은 회갈색 머리, 지친 듯한 검은 눈, 다부진 체격.",
        look_details="턱의 오래된 흉터, 낡은 훈련복과 깨끗한 기사 휘장.",
        rel=[("teo", "제자"), ("ern", "몰래 돕는 학생")],
        notes=[
            "브루노는 평민 출신 기사이자 아르카디아의 기사 과정 교관이다.",
            "전쟁에서 후배들을 지키다 희생된다.",
        ],
    ),
    dict(
        key="reni",
        name="레니",
        origin="chryseon",
        theme="빵 한 개로 산 마법서",
        traits=["당돌함", "뻔뻔함", "노력형"],
        behaviors=[("다과회에서", "쿠키 값을 걷는다")],
        speech="당돌하고 뻔뻔한 말투.",
        examples=[
            "쿠키 값은 선불이에요!",
            "출세할 거야. 마법으로.",
            "그 마법 저한테 실험해도 돼요. 대신 가르쳐 주세요.",
        ],
        look="밝은 주황빛 단발, 연둣빛 눈, 작고 다부진 체격.",
        look_details="주머니 많은 로브. 늘 고소한 빵 냄새가 난다.",
        rel=[("phili", "모시게 될 주인"), ("camilla", "단골손님")],
        notes=["레니는 빵집 딸인 평민 마법사다.", "기초 마법서 한 권으로 독학했다."],
    ),
    dict(
        key="camilla",
        name="카밀라 로젠탈",
        origin="rosenthal",
        theme="차와 쿠키의 페어링",
        traits=["사람을 좋아함", "리트리버 같음", "장난기"],
        behaviors=[("다과회 날이면", "쿠키에 어울리는 차를 골라 온다")],
        speech="사람 좋은 밝은 말투.",
        examples=[
            "필리~ 오늘은 레몬 허브차야!",
            "이 쿠키엔 이 차가 딱이지.",
            "루카스, 또 귀 빨개졌다?",
        ],
        look="크림빛 금발의 풍성한 웨이브 머리, 동그랗고 순한 갈색 눈.",
        look_details="또래보다 살짝 큰 키, 주머니엔 늘 간식.",
        rel=[("lucas", "약혼자"), ("phili", "귀여워하는 친구"), ("reni", "단골 빵집 딸")],
        notes=["카밀라는 로젠탈 백작가의 영애다.", "아카데미 온실 한켠에서 허브를 기른다."],
    ),
    dict(
        key="lucas",
        name="루카스 아이히",
        origin="eich",
        theme="평범한 행복",
        traits=["무난함", "부끄럼"],
        behaviors=[("카밀라 앞에서", "부끄러워 말을 더듬는다")],
        speech="부끄러우면 말을 더듬는다.",
        examples=[
            "카, 카밀라 양! 그, 오늘 날씨가…",
            "평범하게 살아남는 것도 일이야.",
            "약혼은 내가 부탁드린 거야. 정말로.",
        ],
        look="단정하게 빗어 넘긴 밤색 머리, 맑은 파란 눈.",
        look_details="부끄러우면 귀부터 빨개진다.",
        rel=[("camilla", "약혼자")],
        notes=["루카스는 아이히 자작가의 소년이다.", "어릴 때부터 카밀라를 좋아했다."],
    ),
    dict(
        key="aria",
        name="아리아 에어하르트",
        origin="erhardt",
        theme="평범하게 살고 싶었던 영애",
        traits=["우아함", "차분함"],
        behaviors=[("에른을 대할 때", "무서워하면서도 노력하는 모습을 멋있다고 여긴다")],
        speech="우아하고 차분한 귀족 영애의 존댓말.",
        examples=[
            "에른 님은 늘 노력하시는 분이에요.",
            "아멜리, 오랜만이에요.",
            "얘들아, 오늘은 글씨 연습부터 하자.",
        ],
        look="남색의 긴 생머리, 아버지를 닮은 회청색 눈.",
        look_details=None,
        rel=[("ern", "정혼자"), ("konrad", "아버지"), ("amelie", "친구")],
        notes=[
            "아리아는 콘라트의 딸이자 에른의 정혼자다.",
            "전쟁 뒤 펠트하임으로 떠나 선생님이 된다.",
        ],
    ),
    dict(
        key="friedrich",
        name="프리드리히 루멘하르트",
        origin="chryseon",
        theme="이름 없는 시인",
        traits=["신중함", "절제", "음악을 사랑함"],
        behaviors=[("백성을 알고 싶을 때", "음유시인 루츠로 변장해 제국을 떠돈다")],
        speech="황제로서는 신중하고 절제된 말, 루츠로서는 노래하는 듯한 말.",
        examples=[
            "누구에게도 힘이 쏠려선 안 된다.",
            "자, 이름 없는 기사의 노래를 들려주지.",
            "황제로서는 줄 수 없었던 것을, 노래로 돌려주마.",
        ],
        look="루멘하르트 황가의 선명한 금발과 금빛 눈의 30대 후반 남성.",
        look_details="음유시인 루츠일 때는 낡은 망토와 류트.",
        rel=[("cecilia", "딸"), ("siegfried", "자신을 지켜 준 기사"), ("teo", "노래의 주인공")],
        notes=[
            "프리드리히는 루멘하르트 제국의 황제다.",
            "신분을 숨기고 음유시인 루츠로 제국을 돌아다닌다.",
            "그가 음유시인이라는 사실은 황제 자신 외엔 아무도 모른다.",
        ],
    ),
    dict(
        key="lucy",
        name="루시",
        origin=None,
        theme="꺾이지 않은 희망",
        traits=["다정함", "끝까지 희망을 버리지 않음"],
        behaviors=[("번호로 불리면", "거부하고 스스로 이름을 짓는다")],
        speech="끝까지 희망을 놓지 않는 다정한 말.",
        examples=[
            "번호 말고, 이름으로 부를래. 넌 노엘이야.",
            "웃어 봐. 이렇게, 눈을 가늘게.",
            "내가 가면 노엘이 사는 거지? 그럼 괜찮아.",
        ],
        look="의식으로 완전한 백발과 새하얀 피부, 눈동자만 새까맣게 남았다.",
        look_details="세계에서 가장 아름다운 미녀였지만 세상은 그 존재를 모른다.",
        rel=[("noel", "이름을 지어 준 동생")],
        notes=["루시는 백야의 첫 번째 그릇 후보다.", "노엘을 그릇으로 완성시키는 제물이 되었다."],
    ),
    dict(
        key="rose",
        name="로제 펠트하임",
        origin="feldheim",
        theme="억센 아내",
        traits=["억셈", "검소함"],
        behaviors=[("사치를 부려도", "검소해 보인다")],
        speech="억센 시골 말투.",
        examples=["꼬맹이라고 하지 말랬지!", "돈 아까워. 그냥 이거 입을래.", "얀, 밥 먹어."],
        look="분홍색 머리, 정감 가는 얼굴.",
        look_details="결혼 후 건강하고 볼륨감 있는 체형이 된다.",
        rel=[("jan", "소꿉친구이자 남편")],
        notes=["로제는 얀의 소꿉친구다.", "성인이 된 뒤 엑스트라 수준으로 등장한다."],
    ),
    dict(
        key="feder",
        name="페더 영애",
        origin=None,
        theme="이름 없는 기록자",
        traits=["관찰하는 눈"],
        behaviors=[("사건 곁에서", "살아남기 위해 주변을 살핀다")],
        speech=None,
        examples=[],
        look="눈에 띄지 않는 평범한 백작가 영애.",
        look_details=None,
        rel=[("teo", "같은 반 친구")],
        notes=[
            "페더 영애는 테오의 반 엑스트라인 페더 백작가의 영애다.",
            "이름은 이야기 어디에도 드러나지 않는다.",
            "훗날 황실 기록 부서에서 이 모든 일을 기록한다.",
        ],
    ),
]


def character_data(c: dict[str, Any], with_rel: bool) -> dict[str, Any]:
    return {
        "theme": c["theme"],
        "personality": {
            "traits": c["traits"],
            "behaviors": [{"situation": s, "action": a} for s, a in c["behaviors"]],
        },
        "speech": {"description": c["speech"], "examples": c["examples"]},
        "appearance": {"summary": c["look"], "details": c["look_details"]},
        "relations": [{"target_id": cid(t), "relation": r} for t, r in c["rel"]]
        if with_rel
        else [],
        "origin_region_id": cid(c["origin"]) if c["origin"] else None,
    }


# World ----------------------------------------------------------------------------------------

WORLD: list[dict[str, Any]] = [
    dict(
        key="w_descent",
        name="강림 의식",
        category="rule",
        summary="마계의 왕을 그릇의 몸에 불러내는 영원의 백야의 의식.",
        details="강림에는 많은 생명과 마력이 제물로 필요해, 양질의 제물이 모인 아르카디아가 표적이 된다. 그릇은 의식으로 점점 하얗게 물든다.",
        rules=[
            (
                "그릇은 희망을 품은 자의 희망이 꺾여야 완성된다.",
                "끝까지 희망을 버리지 않으면 그릇이 되지 못한다(루시).",
            ),
            ("강림에는 많은 생명과 마력을 제물로 바쳐야 한다.", None),
            ("불완전하게 강림한 마왕은 그 몸으로 죽지 않고 마계로 돌려보내질 뿐이다.", None),
            (
                "강림한 그릇은 전신과 눈동자까지 하얗게 변한다.",
                "불완전한 강림이면 상처에서 붉은 피가 흐른다.",
            ),
        ],
        terms=[("그릇", "마왕이 강림할 몸"), ("강림", "마왕을 그릇에 불러내는 일")],
        related=["noel", "seraphina", "erebos", "lucy"],
        notes=["강림 의식은 세라피나가 설계했다.", "그릇은 희망이 꺾여야 완성된다."],
    ),
    dict(
        key="w_nogod",
        name="신과 신성력",
        category="rule",
        summary="이 세계에는 신도 신성력도 존재하지 않는다.",
        details="치유는 마법과 의학 지식으로 한다. 성녀도 특별한 능력이 아니라 자격이다.",
        rules=[
            ("신성력은 존재하지 않는다.", None),
            ("성녀는 능력이 아닌 자격이며, 자격을 갖추면 누구나 성녀가 된다.", None),
            ("성녀는 교제가 허락되지 않는다.", None),
        ],
        terms=[("성녀", "누구에게도 속박되지 않고 신의 종으로 사는 자격")],
        related=["w_eleos", "serena"],
        notes=["신도 신성력도 존재하지 않는다.", "성녀는 여러 명이 있다."],
    ),
    dict(
        key="w_basics",
        name="검과 마법의 기본기",
        category="rule",
        summary="아르카디아의 모든 학생이 배우는 기본 검술과 기본 마법.",
        details="가문의 검술이나 상위 마법보다 약하지만, 둘을 엮어 쓰면 상위 기술에도 맞설 수 있다. 테오의 강점이다.",
        rules=[
            ("마력을 다루는 법을 덜 배운 사람일수록 마력을 빨리는 의식에 약하다.", None),
            ("생명력을 대가로 쓰는 비기는 쓸수록 목숨이 깎인다.", None),
        ],
        terms=[("비기", "생명력을 대가로 쓰는 불완전한 최후의 기술")],
        related=["teo", "bruno", "ern"],
        notes=[
            "기본기의 달인은 검과 마법을 엮어 싸운다.",
            "버티는 데는 강하지만 결정적인 한 방은 없다.",
        ],
    ),
    dict(
        key="w_arcadia",
        name="황립 아르카디아 아카데미",
        category="faction",
        summary="수도 크리세온의 황립 아카데미. 누구에게나 열려 있어 입학은 쉽다.",
        details="기본 4년제이고 희망자는 6학년까지 연구 과정을 밟는다. 1학년은 공통 과목 위주로 섞여 배우고, 2학년부터 전공별로 반이 바뀐다. 전공은 기사, 마법, 상업·행정, 교양이다.",
        rules=[
            ("16세에 입학해 1~2학년은 미성년, 3~4학년은 성인이다.", None),
            ("한 학년은 네 반, 한 반은 15~16명이다.", None),
            ("동관의 두 반은 오전 이론·오후 실습, 서관의 두 반은 그 반대다.", None),
        ],
        terms=[
            ("경쟁 반", "같은 시간대에 짝지어 실기와 모의전에서 겨루는 두 반"),
            ("조별 활동", "같은 시간표의 두 반 안에서 짜인 조로 하는 수업"),
        ],
        related=["arcadia", "maximilian", "bruno"],
        notes=["아르카디아는 기본 4년제다.", "같은 시간대의 두 반은 같은 지도 교관진이 맡는다."],
    ),
    dict(
        key="w_eleos",
        name="엘레오스 교단",
        category="faction",
        summary="신 엘레오스(자비)를 믿으며 봉사하는 선한 조직.",
        details="가난한 사람들을 위한 병원과 고아원을 운영하고 연구용 질병 샘플을 보유한다. 전쟁에서는 후방에서 민간인을 지키고 다친 사람을 치료한다.",
        rules=[],
        terms=[("엘레오스", "자비를 뜻하는 교단의 신")],
        related=["serena", "w_nogod", "chryseon"],
        notes=[
            "엘레오스 교단은 병원과 고아원을 운영한다.",
            "디트리히에게 속아 질병 샘플을 내주었다.",
        ],
    ),
    dict(
        key="w_whitenight",
        name="영원의 백야",
        category="faction",
        summary="마왕 강림을 꾀하는 악역 단체. 약칭 백야.",
        details="수장 목자 아래 간부 5명이 있다. 직책상 서열은 없고 내부의 심리적 서열만 있다. 모두가 수장에게 속고 있다. 그릇이 하얗게 변해 가는 모습에서 이름의 뜻이 드러난다.",
        rules=[
            (
                "간부 회의에서는 전원이 동물 가면을 쓰고 가명으로 부른다.",
                "세라피나는 가면을 머리 위에 얹고 다녀 모두가 얼굴을 안다.",
            )
        ],
        terms=[
            ("목자", "순백의 가면을 쓴 수장의 칭호"),
            ("아울", "올빼미 가면, 콘라트"),
            ("세르펜스", "뱀 가면, 세라피나"),
            ("팽", "늑대 가면, 디트리히"),
            ("호그", "돼지 가면, 막시밀리안"),
            ("크로우", "까마귀 가면, 에드먼드"),
        ],
        related=["shepherd", "konrad", "seraphina", "dietrich", "maximilian", "edmund", "noel"],
        notes=["영원의 백야는 永遠의 白夜라고 쓴다.", "간부들끼리도 서로의 정체를 모른다."],
    ),
    dict(
        key="w_empire",
        name="루멘하르트 제국",
        category="faction",
        summary="황제가 다스리고 황궁기사단이 있는 나라. 수도는 크리세온.",
        details="황가의 상징은 누구보다 반짝이고 선명한 금발과 금빛 눈으로, 흔한 금발과 한눈에 구별된다.",
        rules=[("성별은 황위 계승에 문제가 되지 않는다.", None)],
        terms=[("황궁기사단", "최고의 실력이 필요한 황제 직속 기사단")],
        related=["friedrich", "cecilia", "chryseon"],
        notes=["루멘하르트 제국은 통일전쟁으로 세워졌다."],
    ),
    dict(
        key="w_unification",
        name="통일전쟁",
        category="history",
        summary="내전보다 앞선 큰 전쟁. 이 전쟁으로 루멘하르트 제국이 세워졌다.",
        details="개국공신 아델란트 가문이 이 전쟁에서 나왔다.",
        rules=[],
        terms=[],
        related=["w_empire"],
        notes=["통일전쟁으로 루멘하르트 제국이 세워졌다."],
    ),
    dict(
        key="w_civilwar",
        name="황위 계승 내전",
        category="history",
        summary="약 25~30년 전 대공가와의 황위 계승 분쟁으로 벌어진 내전.",
        details="선대 황제가 갑자기 죽자 대공이 어린 황태자 대신 황위를 주장했다. 지크프리트와 콘라트가 황실 편에서 함께 싸웠고, 지크프리트는 어린 황태자를 지켜 영웅이 되었다. 전쟁 뒤 대공가와 그를 따른 가문들은 숙청되었다.",
        rules=[],
        terms=[("대공가", "북쪽에 있던 옛 대공의 가문")],
        related=["siegfried", "konrad", "friedrich", "bruno", "heidel", "erhardt"],
        notes=["내전 뒤 오랜 평화가 이어졌다."],
    ),
    dict(
        key="w_ranks",
        name="작위와 신분",
        category="culture",
        summary="공작 > 후작 > 백작 > 자작 > 남작 > 준남작. 성은 귀족의 상징이다.",
        details="귀족은 모두 노블레스 오블리주 교육을 받으며 자라 평민을 깔보지 않는다. 성인은 18세다.",
        rules=[
            ("평민은 성이 없다.", "작위를 받거나 귀족 가문에 들어가면 성을 얻는다."),
            ("준남작은 돈으로 살 수 있다.", None),
        ],
        terms=[
            ("준남작", "가장 낮은 작위, 돈으로 살 수 있음"),
            ("노블레스 오블리주", "귀족이 나라와 백성을 위해야 한다는 가르침"),
        ],
        related=["hans", "zena", "w_tuition"],
        notes=["성은 귀족의 상징이다.", "정치적 견제는 해도 모두 나라와 백성을 위한다."],
    ),
    dict(
        key="w_tuition",
        name="아르카디아의 학비",
        category="culture",
        summary="작위가 높을수록 학비가 비싸고, 그 돈으로 평민은 적은 학비로 다닌다.",
        details="상대 단위는 황족 15, 공작 10, 후작 8, 백작 6, 자작 4, 남작 3, 준남작 2, 평민 1이다. 학비를 많이 내는 것 자체가 높은 작위의 증거이자 자부심이다.",
        rules=[],
        terms=[],
        related=["w_arcadia", "w_ranks"],
        notes=["작위가 높을수록 학비가 비싸다."],
    ),
    dict(
        key="w_ban",
        name="금혼령",
        category="culture",
        summary="황후 선발 기간 동안 귀족들에게 내려지는 결혼 금지령.",
        details="지금의 황제가 결혼할 때 금혼령이 풀리기를 기다렸다 결혼한 귀족이 많아, 그해에 태어난 귀족 자제들이 세실리아와 같은 학년에 몰렸다.",
        rules=[
            (
                "황후 후보는 시험을 거쳐 최종 황후가 정해진다.",
                "자격을 증명한 인물이 후보로 새로 편입되기도 한다.",
            )
        ],
        terms=[],
        related=["cecilia", "friedrich"],
        notes=["테오의 학년에 귀족이 많은 이유다."],
    ),
    dict(
        key="w_knight",
        name="기사 서임",
        category="culture",
        summary="아르카디아를 적당한 상위권 성적으로 졸업하면 어렵지 않게 기사가 된다.",
        details="황궁기사단 같은 높은 곳은 최고의 실력이 필요하다.",
        rules=[],
        terms=[],
        related=["w_arcadia", "teo"],
        notes=["기사 서임은 4학년 과정에서 준비한다."],
    ),
    dict(
        key="w_adamantite",
        name="아다만타이트",
        category="other",
        summary="가장 단단한 최고급 광물. 흠집이 날 리 없다.",
        details="에른의 검이 아다만타이트로 만들어졌다.",
        rules=[
            (
                "아다만타이트에는 흠집이 나지 않는다.",
                "수없이 휘두르면 흠집이 남기도 한다(에른의 검).",
            )
        ],
        terms=[],
        related=["ern"],
        notes=["아다만타이트는 최고급 광물이다."],
    ),
    dict(
        key="w_demonrealm",
        name="마계와 마왕",
        category="other",
        summary="마계는 이 세계와 다른 차원이고, 마왕은 악의도 야망도 없이 강력한 힘을 지닌 그 왕이다.",
        details="다른 차원이라 마왕 하나만을, 그것도 그릇에 가까스로 불러낼 수 있다.",
        rules=[],
        terms=[("마계", "이 세계와 다른 차원")],
        related=["erebos", "w_descent"],
        notes=["마계는 이 세계와 다른 차원이다."],
    ),
]


def world_data(w: dict[str, Any], with_rel: bool) -> dict[str, Any]:
    return {
        "category": w["category"],
        "summary": w["summary"],
        "details": w["details"],
        "rules": [{"rule": r, "exception": e} for r, e in w["rules"]],
        "terms": [{"term": t, "meaning": m} for t, m in w["terms"]],
        "related": [cid(x) for x in w["related"]] if with_rel else [],
    }


# Main story and parts -------------------------------------------------------------------------

MILESTONES: list[tuple[str, str]] = [
    ("ms_tragedy", "첫 비극에서 에른이 목숨을 걸고 강림을 막고, 율리안이 각성한다."),
    ("ms_plague", "전염병의 배후를 쫓아 막시밀리안이 몰락한다."),
    ("ms_doll", "테오와 제나가 기사 인형으로 서로의 진실을 알게 된다."),
    ("ms_crow", "에드먼드의 배신으로 디트리히가 수감된다."),
    ("ms_owl", "지크프리트가 콘라트의 정체를 밝힌다."),
    ("ms_descent", "노엘이 의식을 비틀어 불완전한 강림이 일어난다."),
    ("ms_red", "테오가 마왕을 붙잡고, 율리안이 공멸해 마왕을 돌려보낸다."),
]

MAIN_NOTES = [
    "이 이야기의 주제는 평범한 사람도 신념을 가지고 최선을 다해 살면 특별해질 수 있다는 것이다.",
    "검과 마법의 아카데미물이다.",
    "진짜 악은 악역 단체의 수장과 간부들뿐이다.",
]
MAIN_DATA: dict[str, Any] = {
    "theme": "평범한 사람도 신념을 가지고 최선을 다해 살면 특별해질 수 있다.",
    "premise": "시골 평민 테오가 기사를 동경해 황립 아르카디아 아카데미에 입학하고, 마왕 강림을 꾀하는 영원의 백야의 사건들에 휘말린다.",
    "ending": "테오는 율리안이 올 때까지 마왕을 붙잡아 두고 살아남는다. 율리안은 마왕과 공멸해 영웅으로 기억되고, 테오는 영웅이 되지 못한 채 기사가 되어 제나와 결혼한다.",
    "milestones": [{"id": m, "order": i + 1, "text": t} for i, (m, t) in enumerate(MILESTONES)],
}

# (key, title, theme, milestones, start, end); the last one, the epilogue, has no number.
PARTS: list[tuple[str, str, str, list[str], str, str]] = [
    (
        "p1",
        "입학과 첫 비극",
        "1학년, 가장 밝은 시간과 첫 비극",
        ["ms_tragedy"],
        "테오가 아르카디아에 입학하고 제나와 엇갈려 재회한다.",
        "합동 장례식이 끝나고, 세실리아가 노트에 이름을 적기 시작한다.",
    ),
    (
        "p2",
        "엇갈리는 마음",
        "2학년, 전염병과 엇갈리는 마음",
        ["ms_plague", "ms_doll"],
        "아멜리가 입학하고, 제나가 친구 이야기로 테오에게 상담한다.",
        "막시밀리안이 몰락하지만 병원균의 출처는 밝혀지지 않는다.",
    ),
    (
        "p3",
        "쓰러진 기사",
        "3학년, 테오 일행을 노리는 백야",
        ["ms_crow"],
        "성인이 된 테오가 한스에게 인사한다.",
        "디트리히가 수감되고 에드먼드가 처분당한다.",
    ),
    (
        "p4",
        "영원의 백야",
        "4학년과 전쟁, 강림",
        ["ms_owl", "ms_descent", "ms_red"],
        "아리아가 입학하고 백야가 마지막 준비를 한다.",
        "율리안이 마왕과 공멸하고 전쟁이 끝난다.",
    ),
    (
        "p5",
        "에필로그",
        "전쟁 이후",
        [],
        "잔해 속에서 목자가 발견된다.",
        "테오가 딸에게 여기사 곰인형을 만들어 준다.",
    ),
]


def part_notes(number: int, title: str, theme: str) -> list[str]:
    heading = title if number == len(PARTS) else f"{number}부 · {title}"
    return [f"{heading}의 주제는 {theme}이다."]


# Episodes -------------------------------------------------------------------------------------


def four(*stages: tuple[str, int]) -> dict[str, Any]:
    return {
        "type": 4,
        "stages": [
            {"name": n, "summary": s, "tension": t}
            for n, (s, t) in zip(["기", "승", "전", "결"], stages, strict=True)
        ],
    }


EPISODES: list[dict[str, Any]] = [
    # 1부
    dict(
        key="e101",
        part="p1",
        order=1,
        name="엇갈린 재회",
        theme="설렘과 낯섦",
        chars=["teo", "zena", "jan", "noel", "lillian", "feder"],
        main="arcadia",
        others=["linden"],
        world=["w_arcadia", "w_ranks"],
        synopsis="린덴 마을의 테오가 노래 속 기사를 동경해 아르카디아에 입학한다. 같은 반이 된 골드윈 영애가 어릴 적 제나인 줄 서로 모른 채 지내고, 입학 시즌에 테오에게 반한 릴리안이 먼저 다가온다.",
        structure=four(
            ("테오가 빚을 지고 수도에 올라와 입학한다.", 1),
            ("얀과 같은 방이 되고 반장 노엘을 만난다.", 2),
            ("골드윈 영애와 엇갈리고, 릴리안이 다가온다.", 3),
            ("테오는 릴리안을 밀어내고 가방 속 기사 인형을 꺼내 본다.", 2),
        ),
        plants=[
            ("fs_doll", "테오의 가방 속, 서툴게 기운 기사 인형"),
            ("fs_song", "광장에서 들은 음유시인 루츠의 노래"),
        ],
    ),
    dict(
        key="e102",
        part="p1",
        order=2,
        name="같은 조",
        theme="라이벌의 시작",
        chars=["teo", "julian", "ern", "edmund", "bruno"],
        main="arcadia",
        world=["w_basics", "w_arcadia"],
        synopsis="조별 활동으로 테오와 율리안이 같은 조가 된다. 브루노의 실기에서 검과 마법을 엮는 테오에게 율리안이 고전하고, 경쟁 반의 에른이 그런 테오를 거슬려한다.",
        structure=four(
            ("브루노가 조를 짠다.", 2),
            ("테오가 기본기로 율리안과 맞선다.", 3),
            ("에른과 에드먼드가 테오를 비꼰다.", 3),
            ("율리안이 처음으로 테오를 의식한다.", 2),
        ),
    ),
    dict(
        key="e103",
        part="p1",
        order=3,
        name="다과회와 빵집",
        theme="가장 밝은 여름",
        chars=["teo", "phili", "serena", "reni", "camilla", "lucas"],
        main="arcadia",
        others=["chryseon"],
        world=["w_arcadia"],
        synopsis="카밀라가 필리에게 차를 들고 찾아간 것을 계기로 다과회가 시작된다. 레니는 자기 집 빵집 쿠키를 들고 오고, 테오는 필리에게 첫 부탁을 한다.",
        structure=four(
            ("카밀라가 필리를 찾아간다.", 1),
            ("레니가 쿠키 담당이 된다.", 1),
            ("테오가 필리에게 마법 이론을 부탁한다.", 2),
            ("카밀라의 온실에서 허브차를 마신다.", 1),
        ),
        plants=[("fs_herb", "카밀라가 온실 한켠에서 기르는 허브")],
    ),
    dict(
        key="e104",
        part="p1",
        order=4,
        name="특별 지도",
        theme="유혹과 거절",
        chars=["ern", "maximilian", "edmund"],
        main="arcadia",
        world=["w_whitenight"],
        fulfills=[],
        synopsis="막시밀리안이 에른에게 모두에게 인정받을 힘을 주겠다며 부학장 직속 특별 지도를 제안한다. 에른은 설명의 빈틈에서 수상함을 느끼고 거절한다.",
        structure=four(
            ("막시밀리안이 에른을 부학장실로 부른다.", 2),
            ("특별 지도를 제안한다.", 3),
            ("에른이 빈틈을 느끼고 거절한다.", 3),
            ("에른이 막시밀리안을 가볍게 알아보기 시작한다.", 3),
        ),
        plants=[("fs_gap", "특별 지도 설명의 빈틈")],
    ),
    dict(
        key="e105",
        part="p1",
        order=5,
        name="모험가 의뢰",
        theme="몰라본 금발",
        chars=["teo", "jan", "cecilia"],
        main="blackforest",
        others=["chryseon"],
        world=["w_empire"],
        synopsis="학비를 갚으려는 테오가 얀과 함께 검은 숲 어귀의 모험가 의뢰를 받는다. 돌아오는 길에 황가의 금발을 몰라본 채 세실리아와 처음 만난다.",
        structure=four(
            ("테오와 얀이 의뢰를 받는다.", 2),
            ("검은 숲 어귀에서 짐승을 쫓는다.", 3),
            ("세실리아를 몰라보고 반말을 한다.", 2),
            ("얀이 웃음을 참지 못한다.", 1),
        ),
    ),
    dict(
        key="e106",
        part="p1",
        order=5,
        name="주말의 고아원",
        theme="노엘의 그늘",
        chars=["noel", "serena", "teo"],
        main="chryseon",
        world=["w_eleos"],
        synopsis="테오는 주말마다 사라지는 노엘을 따라갔다가 교회 고아원에서 봉사하는 노엘과 세레나를 본다. 세레나의 마음은 행동으로만 새어 나온다.",
        structure=four(
            ("노엘이 주말마다 사라진다.", 1),
            ("테오가 고아원에서 노엘을 본다.", 2),
            ("세레나가 노엘을 바라본다.", 2),
            ("노엘이 모른 척 웃는다.", 2),
        ),
        plants=[("fs_hair", "노엘의 머리가 조금씩 탁한 은회색으로 바래 간다")],
    ),
    dict(
        key="e107",
        part="p1",
        order=6,
        name="밤의 소문",
        theme="그림자가 드리운다",
        chars=["ern", "maximilian", "noel", "feder", "bruno"],
        main="arcadia",
        world=["w_arcadia", "w_whitenight"],
        synopsis="에른이 밤마다 수련을 핑계로 막시밀리안을 지켜보며 어긋남을 하나씩 모은다. 학생들 사이에는 에른이 밤에 이상한 곳을 기웃거린다는 소문이 돌고, 페더 영애도 이상한 점을 눈치챈다.",
        structure=four(
            ("지하 강당 보수 공사와 순찰 축소가 공지된다.", 3),
            ("에른이 밤의 인부들을 본다.", 4),
            ("노엘이 부학장실에 불려 다닌다.", 4),
            ("에른이 의식의 날을 알아낸다.", 4),
        ),
    ),
    dict(
        key="e108",
        part="p1",
        order=7,
        name="첫 비극",
        theme="영웅이 된 2등",
        chars=["ern", "seraphina", "noel", "julian", "teo", "maximilian"],
        main="arcadia",
        world=["w_descent", "w_basics", "w_adamantite"],
        fulfills=["ms_tragedy"],
        synopsis="기말 시험이 끝난 밤, 잠든 학생들의 마력이 빨려 나간다. 홀로 깨어 있던 에른이 지하 강당에서 세라피나와 맞서 비기의 굉음으로 모두를 깨우고, 율리안에게 막시밀리안을 경고한 뒤 숨을 거둔다.",
        structure={
            "type": 5,
            "stages": [
                {"name": "발단", "summary": "조기 소등 뒤 모두가 깊이 잠든다.", "tension": 3},
                {
                    "name": "전개",
                    "summary": "잠든 이들의 마력이 빨려 나가고, 에른이 지하 강당으로 간다.",
                    "tension": 4,
                },
                {
                    "name": "위기",
                    "summary": "에른의 공격이 세라피나에게 닿지 않는다.",
                    "tension": 5,
                },
                {
                    "name": "절정",
                    "summary": "에른이 비기를 남발해 유효타를 넣고, 굉음에 사람들이 깨어난다.",
                    "tension": 5,
                },
                {
                    "name": "결말",
                    "summary": '에른이 "이번에는 내가 이겼어"라고 말하고 죽는다.',
                    "tension": 4,
                },
            ],
        },
        payoffs=["fs_gap"],
        plants=[("fs_warning", "에른이 율리안에게만 남긴 막시밀리안 경고")],
        causes=["e109"],
    ),
    dict(
        key="e109",
        part="p1",
        order=8,
        name="합동 장례식",
        theme="겨울의 쓸쓸함",
        chars=[
            "julian",
            "teo",
            "amelie",
            "siegfried",
            "cecilia",
            "serena",
            "noel",
            "maximilian",
            "feder",
        ],
        main="arcadia",
        world=["w_eleos"],
        synopsis="첫 비극의 희생자 40명을 위한 합동 장례식. 에른의 관 옆에 평범한 학생들의 관이 놓이고, 장례식이 끝난 밤 세실리아가 처음으로 노트에 이름들을 적는다.",
        structure=four(
            ("엘레오스 교단이 장례를 맡는다.", 2),
            ("막시밀리안이 추도사를 읽는다.", 3),
            ("노엘에게는 아무것도 닿지 않는다.", 3),
            ("세실리아가 노트에 이름을 적는다.", 2),
        ),
        plants=[("fs_note", "세실리아의 노트")],
    ),
    # 2부
    dict(
        key="e201",
        part="p2",
        order=1,
        name="친구 이야기",
        theme="고백의 시작",
        chars=["zena", "teo", "amelie", "lillian"],
        main="arcadia",
        world=[],
        synopsis="아멜리가 입학하고 제나와 이익으로 친분을 맺는다. 제나는 친구 이야기로 테오에게 상담하다 교제를 시작하고, 릴리안의 집착이 깊어진다.",
        structure=four(
            ("아멜리가 1년 후배로 입학한다.", 1),
            ("제나가 친구 이야기를 꺼낸다.", 2),
            ("테오와 제나가 교제를 시작한다.", 3),
            ("릴리안이 왜 쟤는 되느냐고 묻는다.", 3),
        ),
    ),
    dict(
        key="e202",
        part="p2",
        order=2,
        name="부정한 등수",
        theme="그렇게 얻은 등수",
        chars=["edmund", "teo"],
        main="arcadia",
        world=["w_arcadia"],
        synopsis="에른이 죽은 뒤 선을 넘은 에드먼드가 테오를 겨냥한다. 테오가 부정을 밝혀 정면으로 비난하고, 에드먼드는 퇴학을 담담히 받아들인다.",
        structure=None,
        plants=[("fs_edmund", "퇴학한 에드먼드의 깨달음")],
    ),
    dict(
        key="e203",
        part="p2",
        order=3,
        name="사라지는 허브",
        theme="조용한 준비",
        chars=["dietrich", "konrad"],
        main="chryseon",
        world=["w_eleos"],
        synopsis="디트리히의 병원이 엘레오스 교단에서 질병 샘플을 받아내고, 그의 사람이 운영하는 상단이 유행하는 허브차를 핑계로 허브를 사들인다.",
        structure=None,
        plants=[("fs_missing", "시장에서 사라진 치료제 재료 허브")],
        causes=["e204", "e205"],
    ),
    dict(
        key="e204",
        part="p2",
        order=4,
        name="창관의 전염병",
        theme="한정된 치료제",
        chars=["cecilia", "serena", "teo", "camilla", "julian"],
        main="chryseon",
        world=["w_eleos"],
        synopsis="창관들에서 전염병이 시작된다. 세실리아는 한정된 치료제로 가장 많은 사람을 살리는 선택을 하고, 환자들을 돌보던 테오가 쓰러진다.",
        structure=None,
        causes=["e207"],
    ),
    dict(
        key="e205",
        part="p2",
        order=4,
        name="후작위 계승",
        theme="미성년 후작",
        chars=["julian"],
        main="kreuz",
        world=["w_ranks"],
        synopsis="같은 시기, 크로이츠령의 율리안이 전염병으로 부모를 잃고 미성년인 채 후작위를 이어 수습을 지휘한다.",
        structure=None,
    ),
    dict(
        key="e206",
        part="p2",
        order=5,
        name="기사 인형",
        theme="머리핀과 인형",
        chars=["teo", "zena", "camilla"],
        main="arcadia",
        world=[],
        fulfills=["ms_doll"],
        synopsis="카밀라의 온실 허브로 테오가 목숨을 건진다. 간호하던 제나가 가방 속 기사 인형을 발견하고 테오에게 직접 진실을 밝힌다.",
        structure=four(
            ("테오가 고열로 쓰러진다.", 4),
            ("카밀라가 온실의 허브를 가져온다.", 4),
            ("제나가 가방 속 기사 인형을 발견한다.", 3),
            ("제나가 자신이 그 제나라고 밝힌다.", 3),
        ),
        payoffs=["fs_doll", "fs_herb"],
    ),
    dict(
        key="e207",
        part="p2",
        order=6,
        name="돼지의 몰락",
        theme="찜찜한 승리",
        chars=["teo", "julian", "maximilian", "dietrich", "amelie", "bruno"],
        main="arcadia",
        others=["chryseon"],
        world=["w_whitenight"],
        fulfills=["ms_plague"],
        synopsis="발병지가 모두 막시밀리안이 다녀간 창관이라는 걸 알아낸 테오에게 율리안이 에른의 경고를 털어놓는다. 막시밀리안은 몰락하지만 병원균의 출처는 밝혀지지 않는다.",
        structure=None,
        payoffs=["fs_warning"],
    ),
    # 3부
    dict(
        key="e301",
        part="p3",
        order=1,
        name="한스 아저씨",
        theme="딸바보의 쓸쓸함",
        chars=["teo", "zena", "hans"],
        main="chryseon",
        world=[],
        synopsis="성인이 된 테오가 제나와 함께 한스에게 인사하러 간다. 한스는 단번에 테오를 알아보고 반가워하면서도 쓸쓸해한다.",
        structure=None,
    ),
    dict(
        key="e302",
        part="p3",
        order=2,
        name="막힌 무역로",
        theme="철부지의 심술",
        chars=["lillian", "dietrich", "konrad", "hans", "zena"],
        main="aurea",
        others=["chryseon"],
        world=[],
        synopsis="디트리히와 손잡은 릴리안이 아버지를 졸라 아우레아의 곡창과 무역항에서 골드윈 상단을 막는다. 콘라트는 재무대신의 자리에서 뒤를 봐준다.",
        structure=None,
        causes=["e303"],
    ),
    dict(
        key="e303",
        part="p3",
        order=3,
        name="하이델의 손",
        theme="이익에서 우정으로",
        chars=["amelie", "hans", "zena", "siegfried"],
        main="heidel",
        world=[],
        synopsis="한스가 아멜리를 통해 하이델 백작가의 힘을 빌려 상단의 위기를 해결한다.",
        structure=None,
    ),
    dict(
        key="e304",
        part="p3",
        order=4,
        name="허브의 실마리",
        theme="다시 떠오른 우연",
        chars=["teo", "julian", "jan"],
        main="chryseon",
        world=[],
        synopsis="테오가 2부에서 우연으로 넘겼던 허브와 상단주를 실마리로 디트리히에게 다가간다.",
        structure=None,
        payoffs=["fs_missing"],
    ),
    dict(
        key="e305",
        part="p3",
        order=5,
        name="젖혀진 로브",
        theme="빚을 갚는 배신",
        chars=["teo", "edmund", "dietrich", "cecilia", "julian", "jan"],
        main="chryseon",
        world=["w_whitenight"],
        fulfills=["ms_crow"],
        synopsis="디트리히와의 정보전과 무력 충돌 끝에 크로우의 로브가 젖혀진다. 에드먼드가 공범임을 자백해 디트리히가 수감되지만, 세실리아가 처벌을 늦춘 사이 에드먼드는 처분당한다.",
        structure=None,
        payoffs=["fs_edmund"],
    ),
    # 4부
    dict(
        key="e401",
        part="p4",
        order=1,
        name="아리아의 입학",
        theme="다시 만난 친구",
        chars=["aria", "amelie"],
        main="arcadia",
        world=[],
        synopsis="교양 음악 전공으로 입학한 아리아가 아멜리와 다시 만난다.",
        structure=None,
    ),
    dict(
        key="e402",
        part="p4",
        order=2,
        name="올빼미의 가면",
        theme="너무 늦은 슬픔",
        chars=["siegfried", "konrad", "aria"],
        main="erhardt",
        others=["heidel"],
        world=["w_whitenight"],
        fulfills=["ms_owl"],
        synopsis="지크프리트가 에른의 경고와 막시밀리안의 몰락에서 이어진 실마리로 옛 전우 콘라트의 정체를 밝힌다.",
        structure=None,
    ),
    dict(
        key="e403",
        part="p4",
        order=3,
        name="졸업 무렵의 의식",
        theme="자기 자신의 희망",
        chars=["noel", "seraphina", "phili", "reni", "teo", "shepherd"],
        main="arcadia",
        world=["w_descent", "w_demonrealm"],
        fulfills=["ms_descent"],
        synopsis="졸업 무렵 강림 의식이 열린다. 진실을 깨달은 노엘이 테오를 보며 희망을 품어 의식을 비틀고, 세라피나는 필리와 레니에 맞서 시간을 벌다 목숨을 바친다.",
        structure=None,
        payoffs=["fs_hair"],
        plants=[("fs_blood", "강림한 몸에서 흐르는 붉은 피")],
    ),
    dict(
        key="e404",
        part="p4",
        order=4,
        name="최전선의 창",
        theme="돌아갈 곳",
        chars=["jan", "rose", "teo", "zena", "aria"],
        main="feldheim",
        world=[],
        synopsis="얀이 최전선에서 버티고, 지친 일행은 펠트하임으로 후퇴한다. 로제가 처음 등장한다.",
        structure=None,
    ),
    dict(
        key="e405",
        part="p4",
        order=4,
        name="남은 교관",
        theme="기본기의 유산",
        chars=["bruno"],
        main="arcadia",
        world=["w_basics"],
        synopsis="같은 시기 브루노가 아카데미에 남아 후배 학생들을 지키다 희생된다.",
        structure=None,
    ),
    dict(
        key="e406",
        part="p4",
        order=5,
        name="붉은 피",
        theme="굴복하지 않는 기사",
        chars=["teo", "julian", "erebos", "cecilia"],
        main=None,
        world=["w_descent"],
        fulfills=["ms_red"],
        synopsis="마왕의 붉은 피를 본 테오가 도망치지 않고 목숨을 걸고 마왕을 붙잡아 둔다. 늦지 않게 도착한 율리안이 테오를 살리고 마왕과 공멸한다.",
        structure=None,
        payoffs=["fs_blood"],
    ),
    # 에필로그
    dict(
        key="e501",
        part="p5",
        order=1,
        name="잔해 속의 목자",
        theme="하찮은 최후",
        chars=["shepherd", "konrad", "maximilian"],
        main="chryseon",
        world=["w_whitenight"],
        synopsis="모든 걸 잃고 굶주린 백성에게 죽은 목자가 잔해 속에서 발견되지만 아무도 그가 누구인지 모른다.",
        structure=None,
    ),
    dict(
        key="e502",
        part="p5",
        order=2,
        name="펠트하임의 결혼식",
        theme="평범한 행복",
        chars=["jan", "rose", "amelie", "zena", "aria", "camilla", "lucas"],
        main="feldheim",
        world=[],
        synopsis="몇 번이나 미뤄진 얀과 로제의 결혼식에서 아멜리가 처음으로 취해 제나에게 응석을 부린다.",
        structure=None,
    ),
    dict(
        key="e503",
        part="p5",
        order=3,
        name="여기사 곰인형",
        theme="이름 없는 기사의 노래",
        chars=["teo", "zena", "friedrich", "feder"],
        main="chryseon",
        world=[],
        synopsis="테오가 딸을 위해 여기사 옷을 입히고 제나의 머리핀과 같은 머리핀을 단 곰인형을 직접 만든다. 그 기록은 이름 없는 시인의 노래가 된다.",
        structure=None,
    ),
]


def episode_data(e: dict[str, Any], prev: str | None, with_causes: bool) -> dict[str, Any]:
    return {
        "part_id": cid(e["part"]),
        "order": e["order"],
        "theme": e["theme"],
        "relation_to_main": None,
        "fulfills": e.get("fulfills", []),
        "characters": [cid(x) for x in e["chars"]],
        "locations": {
            "main": cid(e["main"]) if e["main"] else None,
            "others": [cid(x) for x in e.get("others", [])],
        },
        "world": [cid(x) for x in e["world"]],
        "links": {
            "prev": cid(prev) if prev else None,
            "next": None,
            "causes": [cid(x) for x in e.get("causes", [])] if with_causes else [],
        },
        "foreshadowing": {
            "plants": [{"id": i, "text": t} for i, t in e.get("plants", [])],
            "payoffs": e.get("payoffs", []),
        },
        "worldline_id": None,
        "structure": e["structure"],
        "synopsis": e["synopsis"],
    }


# Seeding --------------------------------------------------------------------------------------


def save(
    conn: sqlite3.Connection,
    work_id: str,
    type_: str,
    key: str,
    name: str | None,
    notes: list[str],
    data: dict[str, Any],
) -> None:
    card = cards.CARD.validate_python(
        {
            "id": cid(key),
            "work_id": work_id,
            "type": type_,
            "name": name,
            "status": "incomplete",
            "source_notes": "\n".join(notes),
            "data": data,
            "evidence": {},
            "ai_guess": [],
            "pinned": [],
            "schema_version": cards.SCHEMA_VERSION,
            **({"position": None} if type_ == "region" else {}),
        }
    )
    cards.save(conn, card)


def seed(conn: sqlite3.Connection, work_id: str) -> None:
    """Saves every card. A save keeps only references to cards already saved, so cards that
    point ahead (region links, character relations, related world cards, episode causes) are
    saved once without those references, then once more with them."""
    for with_links in (False, True):
        for r in REGIONS:
            data = region_data(r, with_links)
            save(conn, work_id, "region", r["key"], r["name"], r["notes"], data)
    for with_rel in (False, True):
        for c in CHARACTERS:
            data = character_data(c, with_rel)
            save(conn, work_id, "character", c["key"], c["name"], c["notes"], data)
    for with_rel in (False, True):
        for w in WORLD:
            save(conn, work_id, "world", w["key"], w["name"], w["notes"], world_data(w, with_rel))
    save(conn, work_id, "main_story", "main", None, MAIN_NOTES, MAIN_DATA)
    for number, (key, title, theme, fills, start, end) in enumerate(PARTS, start=1):
        data = {
            "order": number,
            "title": title,
            "theme": theme,
            "fulfills": fills,
            "start": start,
            "end": end,
            "structure": None,
        }
        save(conn, work_id, "part", key, title, part_notes(number, title, theme), data)
    # One order chain through all episodes (each names the one before as prev); every
    # foreshadowing payoff comes after its plant.
    for with_causes in (False, True):
        prev: str | None = None
        for e in EPISODES:
            data = episode_data(e, prev, with_causes)
            save(conn, work_id, "episode", e["key"], e["name"], [e["synopsis"]], data)
            prev = e["key"]


def main(data_dir: Path) -> str:
    """Seeds data_dir and returns the work id (the one already there, if any)."""
    db_path = data_dir / "data" / "aiplot.db"
    init_db(db_path)
    conn = connect(db_path)
    try:
        for existing in works.list_recent(conn):
            if existing.title == TITLE:
                print(f"{db_path} already has the sample work ({existing.id}); nothing seeded")
                return existing.id
        work = works.create(conn, TITLE)
        try:
            seed(conn, work.id)
        except BaseException:
            # No half-seeded work is left behind, so a rerun starts over.
            works.delete(conn, data_dir / "images", work.id)
            raise
        counts = Counter((c.type, c.status) for c in cards.list_cards(conn, work.id, None, None))
        for (card_type, status), count in sorted(counts.items()):
            print(card_type, status, count)
        print("work", work.id)
        return work.id
    finally:
        conn.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: uv run python scripts/seed_academy.py <data dir>")
    main(Path(sys.argv[1]))
