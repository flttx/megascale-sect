/** Stele inscriptions: the sect's history, told one stone at a time along the pilgrimage. */
export interface LoreEntry { title: string; era: string; text: string; hint: string }

export const STELE_LORE: Record<string, LoreEntry> = {
  stele_spawn: {
    title: '入山碑', era: '开山 · 太初三年', hint: '山门前路起点',
    text: '云阙仙宗，开山于太初三年。祖师御剑过此，见云海翻作玉阶，遂驻足立宗。凡入山者，先卸尘心，再问来路。',
  },
  stele_road_a: {
    title: '问道碑', era: '第一代 · 祖师', hint: '石道东侧',
    text: '昔有樵者问祖师：道在何处？祖师指山下云海：在彼。又指足下石道：亦在此。樵者弃斧随之登山，三十年后，为第二代掌门。',
  },
  stele_road_b: {
    title: '云海碑', era: '宗门典籍 · 卷三', hint: '石道西侧',
    text: '宗门浮于云海之上，海深不可测。典籍载：云下另有一重天地，唯心无挂碍者，于子夜可见其灯火，如星沉水。',
  },
  stele_gate: {
    title: '山门碑', era: '第二代 · 樵者掌门', hint: '山门之后',
    text: '山门五十六丈，不设门扉，亦无守者。祖训曰：来者不拒，去者不留。门槛不在石上，只在人心。',
  },
  stele_stairs: {
    title: '登阶碑', era: '晨课 · 负剑', hint: '长阶尽头西侧',
    text: '长阶九十六级，应周天之数。弟子每日晨课，负剑登阶，一级一息，不疾不徐；至顶回望，心定如镜，方可入殿。',
  },
  stele_forecourt: {
    title: '宗规碑', era: '第四代 · 立规', hint: '云阙广场东侧',
    text: '宗规三则：不以剑欺弱，不以术乱天，不以道骄人。违者不废修为，只罚面壁听钟三百日——钟声里，自有答案。',
  },
  stele_bridge: {
    title: '听松桥记', era: '第七代 · 重修', hint: '西桥桥头',
    text: '此桥原为藤索，风过则松涛满耳，故名听松。第七代掌门以云木重修，仍留旧索于桥下，以记来处之艰。',
  },
  stele_back: {
    title: '后山碑', era: '闭关之地', hint: '主殿之后 · 西',
    text: '后山为闭关之所，古钟不鸣则不入。崖边蒲团，前后坐化三人，临去皆言一语：云起之时，得见天地初开。',
  },
  stele_isle_west: {
    title: '松涛碑', era: '大劫之后', hint: '听松屿',
    text: '听松屿本是一峰之巅。大劫之后，山崩而峰浮，至今随云海缓缓东移，每百年一寸。屿上古松，犹记当年山形。',
  },
  stele_star: {
    title: '摘星碑', era: '无记', hint: '摘星台 · 无桥可渡',
    text: '摘星台悬于天外，无桥可渡。能至此者，剑心已成。台上星辰低垂，伸手可触；然触之即散，唯余一掌清凉。',
  },
  stele_sage: {
    title: '坐忘碑', era: '第三代 · 坐忘', hint: '玄穹峰 · 坐像台地前沿',
    text: '第三代掌门在北方云海之外面朝宗门入定，说听满一万次钟声便醒。弟子年年来此上香，香灰积成了台地，他却渐渐化作了石。钟至今仍在敲，只是没有人再数。',
  },
  stele_dragon: {
    title: '盘龙碑', era: '上古 · 无考', hint: '龙脊岭 · 盘龙台地西侧',
    text: '石龙不是人雕的。开山之前它便盘在柱上，龙首向东，像在等日出。典籍说龙脊岭是它蜕下的旧鳞，绕柱而上的灵风，是它还没吐尽的一口气。',
  },
  stele_tomb: {
    title: '葬剑碑', era: '历代 · 剑修', hint: '万剑冢 · 台地东缘',
    text: '剑修一生只葬一剑。剑尖入土那一刻，便不再以剑为名，下山做个寻常人。碑上名录已刻满三面，第四面至今空白，留给最后一位肯放下剑的人。',
  },
  stele_guixu: {
    title: '归墟碑', era: '无记', hint: '归墟云海 · 天门孤屿',
    text: '归墟是众水所归之处，云海也归于此。古人立天门为界，门外再无记载。曾有弟子御剑穿门而去，数十年后从北方云海归来，说门外仍是云阙。',
  },
}

/** Captions for viewpoint cinematics. */
export const VIEWPOINT_LINES: Record<string, string> = {
  view_spawn: '高山仰止，景行行止。',
  view_stairs: '来路已在云下，一步一阶，皆是归途。',
  view_back_west: '西崖之外，云涛万里，落日熔金。',
  view_back_east: '东望沧溟，石林如戟，拔出云海。',
  view_isle_west: '松风入耳，天池在望。',
  view_star: '手可摘星辰，回首云阙渺。',
  view_sage: '千年一坐，钟声未满。',
  view_dragon: '龙脊化山，一路北去，没入云中。',
  view_tomb: '万剑无主，风过如鸣。',
  view_guixu: '门外无路，云海自归。',
}

/** Map regions each viewpoint unveils on its first visit: [x, z, radius] circles in world metres. */
export const VIEWPOINT_REGIONS: Record<string, { name: string; circles: [number, number, number][] }> = {
  view_spawn: { name: '前山云海', circles: [[-40, 300, 360], [330, 300, 150], [-270, 230, 140]] },
  view_stairs: { name: '南麓石林', circles: [[-620, 330, 360], [680, 380, 360]] },
  view_back_west: { name: '西野石林', circles: [[-760, -300, 360], [-560, -420, 150], [-720, -760, 270]] },
  view_back_east: { name: '东野石林', circles: [[880, -250, 340], [800, -720, 270]] },
  view_isle_west: { name: '天池云径', circles: [[-160, -780, 220], [-302, -102, 110]] },
  view_star: { name: '摘星天外', circles: [[640, -260, 200], [332, -85, 110]] },
  view_sage: { name: '玄穹峰', circles: [[0, -2150, 700], [0, -3050, 700], [-850, -2550, 520], [850, -2550, 520], [-330, -1640, 280], [330, -1640, 280]] },
  view_dragon: { name: '龙脊岭', circles: [[2200, -420, 700], [2400, -1500, 700], [2400, -2700, 700], [2400, 450, 520], [1620, -760, 360]] },
  view_tomb: { name: '万剑冢', circles: [[-2200, -450, 750], [-2400, -1550, 650], [-2400, -2750, 650], [-2400, 450, 520], [-2050, -1600, 350]] },
  view_guixu: { name: '归墟云海', circles: [[0, 2300, 800], [-1600, 1950, 800], [1600, 1950, 800], [-2850, 2050, 620], [2850, 2050, 620], [-900, 1800, 380], [900, 1800, 380]] },
}

/** 万象图录 pages (by entry id): the page text and a clue to where or when each is found. */
export const COMPENDIUM_LORE: Record<string, { text: string; hint: string }> = {
  guardians: {
    hint: '宗门东西两侧的云海中，自山门前路即可望见',
    text: '两尊神像自云海中升起，只露出胸膛与面容。典籍不载其名，只说开山之前它们便已立于此，双手没入云下，仿佛托着整座仙宗。',
  },
  giant_sword: {
    hint: '主殿之后，东峰之巅',
    text: '一柄巨剑倒插于东峰之巅，剑身高逾百丈。传说是祖师开山时从天外引来，用以镇住山下翻涌的地脉。剑刃至今不锈，雨后会映出天光。',
  },
  armillary: {
    hint: '主殿屋顶上空',
    text: '浑天仪悬于主殿之上，无柱无索，自行运转。环上刻着二十八宿与四时节令，弟子观其转动推算天时。据说它停转的那一日，便是天象大变之时。',
  },
  seated_sage: {
    hint: '北方玄穹峰，隔着北面云海',
    text: '一尊坐像端坐于玄穹峰台地，面朝宗门，自座至顶三百余米。相传是一位坐忘的前辈，入定千年，身化为石，至今仍在听宗门的钟声。',
  },
  dragon_pillar: {
    hint: '东方龙脊岭中央的台地',
    text: '一条石龙盘绕天柱而上，高六百余米，龙脊岭的山势便是它的余脉。灵风绕柱而升，御剑者可乘风直上龙首。',
  },
  sky_gate: {
    hint: '南方归墟云海，门足没入云中',
    text: '天门立于归墟云海之上，门足没入云下，不知其深。古人相信穿过此门便是归墟尽头。如今灵风自北而来，从门中呼啸穿过。',
  },
  sword_tomb: {
    hint: '西方万剑冢台地上最高的那一柄',
    text: '历代剑修功成之日，便将佩剑送来此处，剑尖入地，谓之葬剑。最大的一柄高逾五百米；剑落时划出的深沟，风过其中，至今仍如金铁交鸣。',
  },
  kun: {
    hint: '绕宗门巡游，时而破云而出',
    text: '北冥有鱼，其名为鲲。它在云海下潜游，每绕宗门一周便破云而出一次。平飞之时，可御剑停靠于其背。',
  },
  turtle: {
    hint: '西南归墟云海，绕海中孤峰缓缓游动',
    text: '巨鳌负山而行，绕着归墟云海中的孤峰，不知游了多少年。背上的松石与仙亭随它起伏，从未倾覆。它游得极慢，随时可以御剑落上鳌背。',
  },
  cranes: {
    hint: '宗门四周的空中，需靠近拍摄',
    text: '宗门的仙鹤成行绕山而飞，听到钟声便会惊散，片刻后再归队。弟子说，鹤影最密之处，便是灵气最盛之地。',
  },
  lightning: {
    hint: '雷暴天气中，于闪电亮起的一刻按下快门',
    text: '雷暴之时，电光在云海上空一闪即逝。司天祭坛可请来雷暴，电光何时落下，却由不得人。',
  },
  stars: {
    hint: '晴朗的夜里，抬头望向星空',
    text: '无云之夜，星河自天顶垂到云海尽头。摘星顶的名字，便来自第一代弟子在此数星的夜晚。',
  },
  golden_hour: {
    hint: '日出或日落时，让太阳入画',
    text: '日出日落之时，太阳贴着群峰，把云海染成金色。弟子晨课登阶，暮课回望，看的便是这一刻。',
  },
  snow_peaks: {
    hint: '落雪一阵、群山积白之后，拍摄远山',
    text: '落雪之后，千峰尽白，云海反倒显得更暗。积雪要等雪落一阵才会积起，雪停后又慢慢化去。',
  },
}

/** Always-visible heart of the sect (road, stairs, platform). */
export const CORE_REGION: [number, number, number][] = [[0, -260, 300], [0, 90, 110]]
