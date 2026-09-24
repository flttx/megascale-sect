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
}

/** Captions for viewpoint cinematics. */
export const VIEWPOINT_LINES: Record<string, string> = {
  view_spawn: '高山仰止，景行行止。',
  view_stairs: '来路已在云下，一步一阶，皆是归途。',
  view_back_west: '西崖之外，云涛万里，落日熔金。',
  view_back_east: '东望沧溟，石林如戟，拔出云海。',
  view_isle_west: '松风入耳，天池在望。',
  view_star: '手可摘星辰，回首云阙渺。',
}

/** Map regions each viewpoint unveils on its first visit: [x, z, radius] circles in world metres. */
export const VIEWPOINT_REGIONS: Record<string, { name: string; circles: [number, number, number][] }> = {
  view_spawn: { name: '前山云海', circles: [[-40, 300, 360], [330, 300, 150], [-270, 230, 140]] },
  view_stairs: { name: '南麓石林', circles: [[-620, 330, 360], [680, 380, 360]] },
  view_back_west: { name: '西野石林', circles: [[-760, -300, 360], [-560, -420, 150], [-720, -760, 270]] },
  view_back_east: { name: '东野石林', circles: [[880, -250, 340], [800, -720, 270]] },
  view_isle_west: { name: '天池云径', circles: [[-160, -780, 220], [-302, -102, 110]] },
  view_star: { name: '摘星天外', circles: [[640, -260, 200], [332, -85, 110]] },
}

/** Always-visible heart of the sect (road, stairs, platform). */
export const CORE_REGION: [number, number, number][] = [[0, -260, 300], [0, 90, 110]]
