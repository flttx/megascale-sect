import { useUiStore } from './uiStore'
import type { Language } from './uiStore'

const ENGLISH: Record<string, string> = {
  Language: 'Language', '语言': 'Language', '中文': '中文',
  '云阙仙宗': 'Yunque Celestial Sect', '云': 'Yunque',
  '云端 · 巨构实境漫游': 'ABOVE THE CLOUDS · A COLOSSAL REALM',
  '入云阙，': 'Enter Yunque', '见云海。': 'Rise above.',
  '登临四百二十米云阙，步行或御剑探索，寻访碑文与云海，收集 {count} 道灵光。': 'Explore the 420 m sect on foot or by sword. Find steles, cross the cloud sea, and gather {count} spirit lights.',
  '山门已开 · READY': 'THE GATES ARE OPEN · READY', '正在凝聚山川云气… {percent}%': 'Gathering the mountain mists… {percent}%', '正在准备世界…': 'Preparing the world…',
  '已有存档版本暂不支持，已保留原档并暂停保存。': 'This save version is not supported. The original has been preserved and saving is paused.',
  '本机存储不可用，本次进度未能保存。': 'Local storage is unavailable. Progress from this session could not be saved.',
  '继续旅程 · {place}': 'Resume · {place}', '在{place}附近': 'near {place}', '{place}一带': 'around {place}', '进入仙宗': 'Enter the sect', '载入仙宗 {percent}%': 'Loading the sect {percent}%',
  '操作说明': 'CONTROLS', '行走': 'Walk', '视角': 'Look', '召剑御空': 'Summon sword / fly', '交互': 'Interact', '卷轴舆图': 'Sect scroll', '暂停设置': 'Pause / settings',
  '主殿 420m': 'Main Hall 420 m', '山门 56m': 'Mountain Gate 56 m', '侧塔 6座': 'Six side towers',
  '选择角色': 'Choose character', '角色': 'Character', '玄霄': 'Xuanxiao', '凌霜': 'Lingshuang', '云阙一号': 'Pilgrim', '云阙二号': 'Wayfarer',
  '静止': 'Paused', '总音量': 'Master', '乐曲': 'Music', '环境': 'Ambience', '音效': 'Sound effects',
  '行走 / 御剑': 'Walk / fly', '鼠标': 'Mouse', '疾行 / 加速': 'Sprint / boost', '跃起 · 升降': 'Jump · ascend / descend', '召剑 / 落地': 'Summon / land', '刹停': 'Brake', '环视': 'Free look', '隐藏界面': 'Hide HUD', '换人': 'Switch character', '设置': 'Settings',
  '暂停 · 设置': 'Pause · Settings', '继续游戏并锁定视角': 'Resume and lock the pointer', '继续': 'Resume',
  '画面': 'Display', '画质': 'Quality', '画质档位': 'Quality preset', '自动降档：帧率不足时自动调低画质': 'Automatically lower quality when the frame rate drops', '自动': 'Auto',
  '视野': 'Field of view', '视野角度': 'Field of view', '灵敏度': 'Sensitivity', '鼠标灵敏度': 'Mouse sensitivity',
  '声音': 'Audio', '静音': 'Mute', '有声': 'On', '已静音': 'Muted', '总音量音量': 'Master volume', '乐曲音量': 'Music volume', '环境音量': 'Ambience volume', '音效音量': 'Sound effects volume', 'Volume': 'Volume',
  '天时': 'Time & weather', '时辰': 'Time', '流速': 'Time scale', '时间流速': 'Time scale', '暂停时间': 'Pause time', '暂停昼夜流转': 'Pause the day-night cycle', '已暂停': 'Paused', '流转中': 'Running', '自然流转': 'Cycle naturally', '固定': 'Fixed', '自动变换天象': 'Cycle weather automatically',
  '操作': 'Controls', '设置自动保存于本机 · 菜单期间世界继续运行': 'Settings save locally · the world keeps running while paused', '存档版本无法读取，已保留原档并暂停保存': 'The save version cannot be read. The original is preserved and saving is paused.', '本机存储不可用，本次进度未能保存': 'Local storage is unavailable. This session cannot be saved.', '再': 'then', '或点击空白处继续': 'or click outside to resume',
  '流畅': 'Low', '均衡': 'Medium', '极致': 'High',
  '晴空': 'Clear', '山岚': 'Misty', '细雨': 'Rain', '落雪': 'Snow', '雷暴': 'Storm',
  '地面行走': 'On foot', '凝气召剑': 'Summoning sword', '跃起踏剑': 'Boarding sword', '御剑飞行': 'Sword flight', '御剑降落': 'Landing', '收剑落地': 'Dismounting',
  '入山碑': 'Mountain Gate Stele', '问道碑': 'Path-Seeking Stele', '云海碑': 'Cloud Sea Stele', '山门碑': 'Gate Stele', '登阶碑': 'Stairway Stele', '宗规碑': 'Sect Rules Stele', '听松桥记': 'Pinewind Bridge Record', '后山碑': 'Rear Mountain Stele', '松涛碑': 'Pinewave Stele', '摘星碑': 'Star-Picking Stele',
  '回望阶': 'Homeward Stairs', '西崖': 'Western Cliff', '东崖': 'Eastern Cliff', '松风台': 'Pinewind Terrace', '摘星顶': 'Star-Picking Summit',
  '云阙古钟': 'Yunque Bell', '司天祭坛': 'Weather Altar', '观云蒲团': 'Cloud-Watching Cushion', '望月蒲团': 'Moon-Gazing Cushion', '山门阵': 'Gate Array', '云阙阵': 'Yunque Array', '后山阵': 'Rear Mountain Array', '听松阵': 'Pinewind Array', '摘星阵': 'Star-Picking Array',
  '听松屿': 'Pinewind Isle', '望月台': 'Moonwatch Terrace', '栖霞屿': 'Rosy Cloud Isle', '摘星台': 'Star-Picking Terrace', '流云屿': 'Drifting Cloud Isle', '鹤鸣屿': 'Crane Song Isle', '天池': 'Sky Lake', '锁云屿': 'Cloudbound Isle',
  '石碑': 'Stele', '观景': 'Overlook', '古钟': 'Bell', '祭坛': 'Altar', '蒲团': 'Meditation', '传送阵': 'Waygate', '研读': 'Read', '远眺': 'Gaze', '撞钟': 'Ring', '祈天': 'Pray', '打坐': 'Meditate', '传送': 'Travel',
  '石道长阶': 'Pilgrim Road', '云阙广场': 'Yunque Plaza', '桥下': 'Beneath Bridges', '浮屿': 'Floating Isles', '石林之巅': 'Pillar Peaks', '主殿檐顶': 'Hall Rooftops', '天路': 'Skyway', '鲲背': 'Kunback',
  '仰止台': 'Reverence Overlook', '前山云海': 'Front Mountain Cloud Sea', '南麓石林': 'Southern Pillar Forest', '西野石林': 'Western Pillar Forest', '东野石林': 'Eastern Pillar Forest', '天池云径': 'Sky Lake Cloudway', '摘星天外': 'Beyond the Stars',
  '晴': 'Clear', '岚': 'Mist', '雨': 'Rain', '雪': 'Snow', '雷': 'Storm',
  '原色': 'Original', '暖阳': 'Warm', '水墨': 'Ink', '清寒': 'Cool',
  '主角一 · 男': 'Male Wanderer', '主角二 · 女': 'Female Wanderer',
  '山门前路': 'The Gate Approach', '穿越山门': 'Through the Mountain Gate', '登临长阶': 'The Grand Stairway', '主平台 · 云阙': 'Yunque Plaza', '鲲背 · 云上巡游': 'Kunback · Cloudsea Flight',
  '目标 · 穿山门，登主平台，接近主殿': 'Pass through the gate and approach the main hall', '目标 · 沿长阶而上，直抵主平台': 'Climb the grand stairs to the plaza', '目标 · 登顶长阶，入云阙广场': 'Reach the top of the stairs and enter Yunque Plaza', '自由探索 · 灵光、碑文、观景台与传送阵': 'Free roam · spirit lights, steles, overlooks, and waygates', '随鲲而行': 'Follow the Kun', '自由探索 · 拾取灵光，F 召剑离开': 'Free roam · gather spirit lights; press F to leave',
  '移动': 'Move', 'MOUSE': 'MOUSE', '加速': 'Boost', '升降': 'Ascend / descend', '落地': 'Land', '隐藏': 'Hide HUD', '音效开': 'Sound on', '音效关': 'Sound off', 'F 召剑': 'F Summon sword', 'F 落地': 'F Land', 'F 取消': 'F Cancel', '聚气中': 'Gathering energy', '正在载入拍照工具…': 'Loading photo tools…', '正在载入{character}与佩剑… {percent}%': 'Loading {character} and sword… {percent}%',
  '仙宗载入进度': 'World loading progress',
  '已收集灵光': 'Spirit lights collected', '灵光': 'Spirit lights', '殿': 'Hall', '北': 'N', '东': 'E', '南': 'S', '西': 'W',
  '云阙主殿': 'Yunque Main Hall', '观景 · ': 'Overlook · ', '传送阵 · ': 'Waygate · ',
  '操作提示': 'Control hints', 'F 召剑 / 落地': 'F Summon sword / land', 'SPACE / C': 'SPACE / C', '设置与操作': 'Settings and controls', '卷轴': 'Scroll', '拍照': 'Photo',
  '卷': 'SCROLL', '云阙卷轴': 'Yunque Scroll', '卷轴页签': 'Scroll tabs', '收起卷轴': 'Close scroll', '切换页签': 'Switch tabs', '移动焦点': 'Move focus', '返回': 'Back',
  '（未至）': ' (unvisited)', '云阙仙宗舆图：显示岛屿、石林、各处碑亭与传送阵，以及你的位置': 'Map of Yunque: islands, pillar forests, steles, waygates, and your position', '鲲 · 平飞时可停靠': 'Kun · dock during level flight', '云阙全境舆图：显示宗门、四方外境（{regions}）与你的位置': 'Map of the whole realm: the sect, the four outer regions ({regions}), and your position', '、': ', ', '宗门': 'Sect', '周边': 'Environs', '全图': 'World', '玄穹峰': 'Azure Vault Peaks', '龙脊岭': 'Dragonspine Ridge', '万剑冢': 'Tomb of Myriad Swords', '归墟云海': 'Guixu Cloud Sea', '图例': 'Legend', '观景台': 'Overlook', '古钟 · 祭坛': 'Bell · altar', '你的位置': 'You are here', '实心为已至之处。云雾遮蔽之地，登临观景台远眺即可揭示。': 'Visited places are shown in solid color. Reveal cloud-covered regions from overlooks.', '已揭示': 'Revealed', '宗门腹地': 'Sect grounds', '碑文目录': 'Stele index', '，已研读': ' · read', '第 {index} 碑，尚未研读': 'Stele {index}, unread', '未读之碑': 'Unread stele', '已录': 'Recorded', '碑文未录': 'Inscription not recorded', '此碑尚待亲往研读。': 'Visit this stele to read its inscription.', '所在：': 'Location: ', '未知': 'Unknown', '金色灵光可步行拾取；青碧与淡紫者，多在桥下、浮屿、石林与殿顶，需御剑方至。罗盘上的 ✦ 指向最近尚有灵光之处。': 'Gold spirit lights can be gathered on foot. Teal and violet lights lie beneath bridges, on isles, pillars, and rooftops. Fly to reach them; the compass star points to the nearest uncollected light.',
  '碑文 · ': 'Stele · ', '已录入卷轴': 'Added to scroll', '收起碑文': 'Close inscription', '收起': 'Close', '司天祭坛 · 祈天': 'Weather Altar · Invocation', '焚香祈天，风云随之而变。': 'Offer incense, and the weather will answer.', '所择天象将驻留八分钟，而后复归自然流转。': 'Your chosen weather lasts eight minutes before natural cycling resumes.', '自然流转已停，天象将一直驻留。': 'Natural cycling is paused; this weather will remain.', '选择天象': 'Choose weather', '祈求': 'Invoke ', '顺其自然，恢复自动天象': 'Resume natural weather cycling', '顺其自然': 'Natural', '离开祭坛': 'Leave altar', '离开': 'Leave',
  '传送阵 · 择地而往': 'Waygate · Choose a destination', '已感应 {count} / {total} 座阵法。未感应之阵，须亲身踏足方能相连。': '{count} of {total} waygates discovered. Visit an undiscovered gate to connect it.', '此处': 'Here', '未感应': 'Undiscovered', '{name}（当前所在）': '{name} (current location)', '传送至{name}，{region}，{distance} 米': 'Travel to {name}, {region}, {distance} m', '{name}尚未感应': '{name} is undiscovered', '后山台地': 'Rear Mountain Terrace', '离开传送阵': 'Leave waygate',
  '拍照模式': 'Photo mode', '已存 {count} 张': '{count} saved', '滤镜（F 切换）': 'Filters (F to cycle)', '暗角': 'Vignette', '降 · 升': 'Descend · ascend', '疾速': 'Fast', '焦距': 'Focal length', '滤镜': 'Filter', '左键 拍摄': 'Left-click to capture', '隐藏面板': 'Hide panel', '退出': 'Exit',
  '正在展开卷轴…': 'Unfurling scroll…', '已回到上次停留之处': 'Returned to your last safe place', '未能回到上次停留处，已自山门启程': 'Could not return to your last position; starting at the mountain gate', '画面已恢复，已回到最近的安全落脚点': 'Graphics restored. Returned to the nearest safe landing.', '画面暂未恢复': 'Graphics could not be restored', '正在恢复画面': 'Restoring graphics', '进度与设置仍保留在本次会话中。请点击重试。': 'Your progress and settings are preserved for this session. Try again.', '正在重建画面，稍后将在最近的安全落脚点继续。': 'Rebuilding the scene. You will resume at the nearest safe landing.', '重试恢复画面': 'Retry graphics recovery',
  '视角锁定未成功，请稍候再点击继续': 'Could not lock the pointer. Wait a moment, then select Resume again.', '已退出拍照，点击画面继续；Esc 打开设置': 'Photo mode closed. Click the scene to resume; press Esc for settings.', '照片保存失败，请稍后再试': 'Could not save the photo. Try again shortly.',
  '云阙仙宗，开山于太初三年。祖师御剑过此，见云海翻作玉阶，遂驻足立宗。凡入山者，先卸尘心，再问来路。': 'The Yunque Sect was founded in the third year of Taichu. Its first master flew here on a sword and saw the cloud sea rise like jade steps. The master settled here, teaching every newcomer to lay down worldly cares before asking where the path leads.',
  '昔有樵者问祖师：道在何处？祖师指山下云海：在彼。又指足下石道：亦在此。樵者弃斧随之登山，三十年后，为第二代掌门。': 'A woodcutter once asked the first master, “Where is the Way?” The master pointed to the cloud sea below: “There.” Then to the stone path beneath their feet: “Here, too.” The woodcutter left his axe and followed. Thirty years later, he became the second master.',
  '宗门浮于云海之上，海深不可测。典籍载：云下另有一重天地，唯心无挂碍者，于子夜可见其灯火，如星沉水。': 'The sect floats above a cloud sea of unknowable depth. The old texts say another world lies beneath the clouds; at midnight, only an unburdened heart can see its lights, like stars beneath water.',
  '山门五十六丈，不设门扉，亦无守者。祖训曰：来者不拒，去者不留。门槛不在石上，只在人心。': 'The mountain gate stands fifty-six zhang tall, without doors or guards. The ancestral teaching says: welcome those who arrive; hold back none who leave. The threshold is not stone, but the heart.',
  '长阶九十六级，应周天之数。弟子每日晨课，负剑登阶，一级一息，不疾不徐；至顶回望，心定如镜，方可入殿。': 'The grand stair has ninety-six steps, echoing the cycles of heaven. Each morning, disciples climb with swords on their backs, one breath per step, neither hurrying nor lingering. At the summit, they look back with minds clear as mirrors, then enter the hall.',
  '宗规三则：不以剑欺弱，不以术乱天，不以道骄人。违者不废修为，只罚面壁听钟三百日——钟声里，自有答案。': 'Three rules govern the sect: never use the sword to bully the weak, magic to disturb the heavens, or the Way to exalt yourself. Offenders do not lose their cultivation; they face the wall and listen to the bell for three hundred days. The sound holds its own answer.',
  '此桥原为藤索，风过则松涛满耳，故名听松。第七代掌门以云木重修，仍留旧索于桥下，以记来处之艰。': 'This bridge was once woven from vines. When the wind passed, the pines filled the ears; thus it was named Pinewind. The seventh master rebuilt it from cloudwood, leaving the old ropes beneath as a reminder of the hard road here.',
  '后山为闭关之所，古钟不鸣则不入。崖边蒲团，前后坐化三人，临去皆言一语：云起之时，得见天地初开。': 'The rear mountain is a retreat for solitary practice; enter only when the ancient bell is silent. Three people passed away on the cliffside cushions. Each left the same words: when the clouds rise, one may glimpse the world at its beginning.',
  '听松屿本是一峰之巅。大劫之后，山崩而峰浮，至今随云海缓缓东移，每百年一寸。屿上古松，犹记当年山形。': 'Pinewind Isle was once a mountain peak. After the great calamity, the mountain broke and the summit floated free. It has drifted east with the cloud sea ever since, an inch each century. The ancient pine still remembers the mountain it came from.',
  '摘星台悬于天外，无桥可渡。能至此者，剑心已成。台上星辰低垂，伸手可触；然触之即散，唯余一掌清凉。': 'The Star-Picking Terrace hangs beyond the world, with no bridge to reach it. Those who arrive have mastered the sword-heart. Stars hang low enough to touch, yet scatter at a hand’s approach, leaving only a cool palm.',
  '开山 · 太初三年': 'Founding · Year Three of Taichu', '第一代 · 祖师': 'First Generation · Founder', '宗门典籍 · 卷三': 'Sect Archive · Volume III', '第二代 · 樵者掌门': 'Second Generation · The Woodcutter Master', '晨课 · 负剑': 'Morning Practice · Sword on Back', '第四代 · 立规': 'Fourth Generation · Rules Established', '第七代 · 重修': 'Seventh Generation · Rebuilt', '闭关之地': 'Place of Retreat', '大劫之后': 'After the Great Calamity', '无记': 'Unrecorded',
  '山门前路起点': 'Start of the mountain gate approach', '石道东侧': 'East of the stone road', '石道西侧': 'West of the stone road', '山门之后': 'Beyond the mountain gate', '长阶尽头西侧': 'West end of the grand stair', '云阙广场东侧': 'East side of Yunque Plaza', '西桥桥头': 'West bridge entrance', '主殿之后 · 西': 'West of the main hall', '摘星台 · 无桥可渡': 'Star-Picking Terrace · no bridge',
  '高山仰止，景行行止。': 'The mountain towers above; the worthy path lies ahead.', '来路已在云下，一步一阶，皆是归途。': 'The road behind lies beneath the clouds. Each step leads home.', '西崖之外，云涛万里，落日熔金。': 'Beyond the western cliff, cloud waves roll for miles beneath a molten sunset.', '东望沧溟，石林如戟，拔出云海。': 'Eastward, pillars rise like spears from the boundless cloud sea.', '松风入耳，天池在望。': 'Pine wind fills the ears; Sky Lake lies ahead.', '手可摘星辰，回首云阙渺。': 'Stars within reach; Yunque fades behind.',
  '静坐观云': 'Meditation · Watch the Clouds', '心随云动，一坐六时。按 E 起身。': 'Let your thoughts drift with the clouds. Sit for six hours. Press E to rise.', '请先落地，再于蒲团上静坐': 'Land before meditating on the cushion.', '请先落地，再凭栏远眺': 'Land before taking in the view.', '卷轴地图已揭示 · ': 'Map region revealed · ', '阵法感应不到你的气息，请先站稳再试': 'The array cannot sense you. Stand on solid ground and try again.', '司天祭坛 · 天象顺其自然': 'Weather Altar · natural cycle restored', '司天祭坛 · 天象将转为': 'Weather Altar · weather changing to ', '传送阵已感应 · ': 'Waygate discovered · ', '已抵达 · ': 'Arrived · ', '鲲将没入云海': 'The Kun is about to dive into the cloud sea', '诸天灵光尽收 · 云阙诸天为你澄明': 'All spirit lights gathered · Yunque shines clear for you', '灵光尽收': 'All spirit lights in this region gathered',
  '降低时间': 'Slow time', 'E 研读 · 入山碑': 'Press E to read · Mountain Gate Stele',
  '鲲': 'Kun', '舆图范围': 'Map scale', '舆图': 'Map', '碑录': 'Codex', '收集': 'Collection', '碑文': 'Steles', '山门': 'Mountain Gate', '长阶': 'Grand Stair', '罗盘：显示方位、观景台、传送阵、主殿与最近的灵光': 'Compass showing cardinal directions, overlooks, waygates, the main hall, and the nearest spirit lights',
  'MEDITATION · 静坐观云': 'MEDITATION · WATCH THE CLOUDS', 'VIEWPOINT · 远眺': 'VIEWPOINT · PANORAMA', '云阙': 'Yunque', '藏经': 'ARCHIVE', '，': ',',
  '角色与动作正在载入，请稍候': 'Character and animations are still loading. Please wait.', '请在平稳、开阔的位置召剑': 'Summon your sword from level, open ground.', '请飞到地面、平台或浮岛上方，再按 F 落地': 'Fly above the ground, a platform, or an isle before pressing F to land.', '下方地势陡峭，请飞到平缓处再落地': 'The ground below is too steep. Find a level place to land.', '鲲正在爬升或入云，请待平飞时停靠': 'The Kun is climbing or entering the clouds. Wait for level flight before docking.', '鲲背此处陡峭，请移到平缓处': 'This part of the Kun is steep. Move to a level area.', '下方有遮挡，请移到开阔处落地': 'There is an obstruction below. Move to a clear area to land.', '鲲正没入云海，无法停靠': 'The Kun is diving into the cloud sea and cannot be boarded now.', '飞剑载你离开鲲背': 'Your sword carries you away from the Kun.', '降落路径出现遮挡，已停止降落': 'The landing path is blocked. Landing was cancelled.', '{group} · 灵光尽收': '{group} · All spirit lights in this region gathered',
}

export function translate(source: string, language: Language, values: Record<string, string | number> = {}): string {
  const template = language === 'en' ? ENGLISH[source] ?? source : source
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match))
}

export function useTranslation() {
  useUiStore((state) => state.language)
  return translateCurrent
}

function translateCurrent(source: string, values?: Record<string, string | number>) {
  return translate(source, useUiStore.getState().language, values)
}